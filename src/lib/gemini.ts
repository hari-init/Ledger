import type { EmailMessage, ParsedEmail, DocTxn } from './types'

const BATCH_SIZE = 4
const MAX_RETRIES = 3
const REQUEST_TIMEOUT_MS = 90_000

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      emailId: { type: 'STRING' },
      isTransaction: { type: 'BOOLEAN' },
      amount: { type: 'NUMBER', description: 'amount in dollars, positive' },
      currency: { type: 'STRING', description: 'ISO code, e.g. CAD' },
      merchant: { type: 'STRING', description: 'merchant or counterparty, cleaned up' },
      date: { type: 'STRING', description: 'transaction date, YYYY-MM-DD' },
      direction: { type: 'STRING', enum: ['debit', 'credit'] },
      accountHint: { type: 'STRING', description: 'card/account mentioned, e.g. "TD Visa ****1234"' },
      category: { type: 'STRING' },
      confidence: { type: 'NUMBER', description: '0 to 1' },
    },
    required: ['emailId', 'isTransaction'],
  },
}

function buildPrompt(emails: EmailMessage[], categories: string[]): string {
  const emailBlocks = emails
    .map(
      (e) =>
        `<email id="${e.id}">\nFROM: ${e.from}\nSUBJECT: ${e.subject}\nDATE: ${e.date}\nBODY:\n${e.body.slice(0, 2000)}\n</email>`,
    )
    .join('\n\n')
  return `You are a bank-email parser for a Canadian personal expense tracker.

For EACH email below, return one JSON object.

An email IS a transaction only if it notifies about actual money movement: a card purchase, debit, pre-authorized payment, bill payment, Interac e-Transfer sent/received, refund, or payroll/deposit. It is NOT a transaction if it is: a promotion/offer, statement-ready notice, balance summary, security alert, login/OTP code, or payment *reminder* (money not yet moved). For non-transactions return {"emailId": "...", "isTransaction": false}.

For transactions:
- amount: positive dollars (e.g. 43.17)
- direction: "debit" if money left the user's account (purchases, sent e-transfers, bills), "credit" if money came in (refunds, received e-transfers, payroll)
- merchant: clean human name ("TIM HORTONS #4021 TORONTO" → "Tim Hortons"); for e-transfers use the counterparty's name
- date: the transaction date as YYYY-MM-DD (fall back to the email date)
- category: exactly one of: ${categories.join(', ')}
- CATEGORY RULES: Money the user SENDS to another person or through a remittance / money-transfer service (Instarem, Wise, Remitly, Western Union, an Interac e-Transfer to a person) is a real expense → use "Money Sent". Reserve "Transfers" ONLY for money moved between the user's own accounts or a payment toward the user's own credit card. Money RECEIVED from another person is a "credit" in category "Transfers".
- accountHint: the card/account mentioned, if any
- confidence: your certainty 0-1 that the extraction is correct

Emails:

${emailBlocks}`
}

export async function parseEmailsWithGemini(
  emails: EmailMessage[],
  categories: string[],
  apiKey: string,
  model: string,
  onProgress?: (done: number, total: number) => void,
  onLog?: (s: string) => void,
): Promise<ParsedEmail[]> {
  if (!apiKey) throw new Error('No Gemini API key set — see Settings → Setup')
  const out: ParsedEmail[] = []
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE)
    const parsed = await callGemini(batch, categories, apiKey, model, onLog)
    out.push(...parsed)
    onProgress?.(Math.min(i + BATCH_SIZE, emails.length), emails.length)
  }
  return out
}

async function callGemini(
  batch: EmailMessage[],
  categories: string[],
  apiKey: string,
  model: string,
  onLog?: (s: string) => void,
): Promise<ParsedEmail[]> {
  onLog?.(`Gemini: sending batch of ${batch.length} to ${model}…`)
  const arr = await generateJSON(
    [{ text: buildPrompt(batch, categories) }],
    RESPONSE_SCHEMA,
    apiKey,
    model,
    onLog,
  )
  if (!Array.isArray(arr)) throw new Error('Gemini did not return an array')
  return arr as ParsedEmail[]
}

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } }

/**
 * One generateContent call returning the raw model text, with the retry /
 * timeout / rate-limit handling shared by every Gemini feature.
 */
async function generateRaw(
  parts: GeminiPart[],
  generationConfig: Record<string, unknown>,
  apiKey: string,
  model: string,
  onLog?: (s: string) => void,
): Promise<string> {
  const body = { contents: [{ role: 'user', parts }], generationConfig }
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let r: Response
    try {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
    } catch (e) {
      // timeout, offline, or blocked by an extension — retry, then surface it
      const why =
        (e as Error).name === 'TimeoutError'
          ? `no response after ${REQUEST_TIMEOUT_MS / 1000}s (timeout)`
          : `network error: ${(e as Error).message} — offline, or an ad-blocker blocking generativelanguage.googleapis.com?`
      lastErr = new Error(`Gemini request failed — ${why}`)
      onLog?.(`${lastErr.message} (attempt ${attempt + 1}/${MAX_RETRIES})`)
      continue
    }
    if (r.status === 429 || r.status === 503) {
      // free-tier rate limit: back off and retry
      const waitS = 15 * (attempt + 1)
      lastErr = new Error(`Gemini rate-limited (${r.status})`)
      onLog?.(`Gemini rate-limited (${r.status}) — waiting ${waitS}s, retry ${attempt + 1}/${MAX_RETRIES}…`)
      await sleep(waitS * 1000)
      continue
    }
    if (!r.ok) {
      const text = await r.text()
      throw new Error(`Gemini API error ${r.status}: ${text.slice(0, 300)}`)
    }
    const j = await r.json()
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('Gemini returned an empty response')
    return text as string
  }
  throw lastErr ?? new Error('Gemini request failed')
}

/** structured-JSON generateContent call, built on generateRaw */
async function generateJSON(
  parts: GeminiPart[],
  responseSchema: unknown,
  apiKey: string,
  model: string,
  onLog?: (s: string) => void,
): Promise<unknown> {
  const text = await generateRaw(
    parts,
    { temperature: 0, responseMimeType: 'application/json', responseSchema },
    apiKey,
    model,
    onLog,
  )
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Gemini returned unparseable JSON: ${String(text).slice(0, 200)}`)
  }
}

/** Answer a natural-language question over the user's transactions. */
export async function askAboutSpending(
  question: string,
  dataCsv: string,
  apiKey: string,
  model: string,
): Promise<string> {
  if (!apiKey) throw new Error('No Gemini API key set — see Settings → Setup')
  const today = new Date().toISOString().slice(0, 10)
  const prompt = `You are a personal-finance assistant answering questions about one person's transactions.

Use ONLY the transaction data below — a CSV with columns: date,merchant,category,direction,amount (CAD; direction is "debit" for money out, "credit" for money in). Today is ${today}.

Rules:
- Be concise and specific. Lead with the direct answer, then a short supporting detail.
- Always format money as CAD (e.g. $1,234.56).
- If the data doesn't contain enough to answer, say so plainly — do not invent numbers.
- When useful, name the top merchants/dates behind a total.

QUESTION: ${question}

TRANSACTIONS (CSV):
${dataCsv}`
  return generateRaw([{ text: prompt }], { temperature: 0 }, apiKey, model)
}

const DOC_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      amount: { type: 'NUMBER', description: 'amount in dollars, positive' },
      currency: { type: 'STRING', description: 'ISO code, e.g. CAD' },
      merchant: { type: 'STRING', description: 'merchant or counterparty, cleaned up' },
      date: { type: 'STRING', description: 'transaction date, YYYY-MM-DD' },
      direction: { type: 'STRING', enum: ['debit', 'credit'] },
      account: { type: 'STRING', description: 'card/account label if shown' },
      category: { type: 'STRING' },
      confidence: { type: 'NUMBER', description: '0 to 1' },
    },
    required: ['amount', 'date', 'direction'],
  },
}

function docPrompt(categories: string[]): string {
  return `You are a bank / credit-card statement parser for a Canadian personal expense tracker.

The attached file is one of: a bank or credit-card statement (PDF), a CSV/spreadsheet export from online banking, or a screenshot of a transaction list. Extract EVERY individual transaction as its own JSON object.

Rules:
- amount: positive dollars (e.g. 43.17), never negative
- direction: "debit" for purchases, withdrawals, fees, bill payments, money out; "credit" for refunds, deposits, payroll, money in
- merchant: clean human name ("SQ *TIM HORTONS 4021" → "Tim Hortons"); for transfers use the counterparty
- date: the posting/transaction date as YYYY-MM-DD, using the statement's year
- category: exactly one of: ${categories.join(', ')}
- CATEGORY RULES: Money SENT to another person or via a remittance / money-transfer service (Instarem, Wise, Remitly, Western Union, e-transfer to a person) → "Money Sent" (it is a real expense). Reserve "Transfers" ONLY for movement between the user's own accounts or a payment toward the user's own credit card.
- account: the card/account label if the document shows one
- confidence: your certainty 0-1

IGNORE non-transaction lines: opening/closing/available balances, interest or fee *summaries*, "minimum payment due", rewards points, page headers/footers, subtotals, and marketing text. Return only real transactions.`
}

/** Extract transactions from an uploaded statement/CSV/receipt via Gemini. */
export async function parseDocumentWithGemini(
  input: { text: string } | { mimeType: string; base64: string },
  categories: string[],
  apiKey: string,
  model: string,
  onLog?: (s: string) => void,
): Promise<DocTxn[]> {
  if (!apiKey) throw new Error('No Gemini API key set — see Settings → Setup')
  const parts: GeminiPart[] = [{ text: docPrompt(categories) }]
  if ('text' in input) {
    parts.push({ text: `\nFILE CONTENT:\n${input.text.slice(0, 200_000)}` })
  } else {
    parts.push({ inline_data: { mime_type: input.mimeType, data: input.base64 } })
  }
  onLog?.(`Gemini: reading document with ${model}…`)
  const arr = await generateJSON(parts, DOC_SCHEMA, apiKey, model, onLog)
  if (!Array.isArray(arr)) throw new Error('Gemini did not return a transaction list')
  return arr as DocTxn[]
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}

/** Models this API key can call with generateContent, e.g. to populate a picker. */
export async function listGeminiModels(apiKey: string): Promise<string[]> {
  if (!apiKey) throw new Error('No Gemini API key set')
  const models: string[] = []
  let pageToken = ''
  do {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
      { headers: { 'x-goog-api-key': apiKey } },
    )
    if (!r.ok) throw new Error(`Could not list models (${r.status}): ${(await r.text()).slice(0, 200)}`)
    const j = await r.json()
    for (const m of j.models ?? []) {
      if (m.supportedGenerationMethods?.includes('generateContent')) {
        models.push((m.name as string).replace(/^models\//, ''))
      }
    }
    pageToken = j.nextPageToken ?? ''
  } while (pageToken)
  return models.sort()
}
