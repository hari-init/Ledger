import type { EmailMessage, ParsedEmail, DocTxn, Settings } from './types'

const BATCH_SIZE = 4
const MAX_RETRIES = 3
const REQUEST_TIMEOUT_MS = 90_000

export interface BedrockMessageContent {
  text?: string
  image?: {
    format: 'png' | 'jpeg' | 'gif' | 'webp'
    base64: string
  }
  document?: {
    format: 'pdf' | 'csv' | 'txt' | 'doc' | 'docx' | 'xls' | 'xlsx' | 'html' | 'md'
    name: string
    base64: string
  }
}

export interface BedrockMessage {
  role: 'user' | 'assistant'
  content: BedrockMessageContent[]
}

export interface BedrockRequestPayload {
  modelId: string
  region: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  messages: BedrockMessage[]
  system?: { text: string }[]
  inferenceConfig?: {
    temperature?: number
    maxTokens?: number
  }
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}

/** Cleanly extracts a JSON array from model text even if wrapped in markdown code fences */
export function extractJsonArray<T>(rawText: string): T[] {
  let cleaned = rawText.trim()
  // strip ```json ... ``` code fence if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim()
  }

  // Find bounding brackets
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1)
  }

  try {
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) {
      throw new Error('Model did not return a JSON array')
    }
    return parsed as T[]
  } catch (err) {
    throw new Error(
      `Failed to parse JSON array from model: ${(err as Error).message}\nRaw output: ${rawText.slice(0, 300)}`,
    )
  }
}

/** Calls the Bedrock proxy endpoint (e.g. /api/bedrock) which signs and invokes Nova Lite via Converse API */
export async function callBedrock(
  payload: BedrockRequestPayload,
  onLog?: (s: string) => void,
): Promise<string> {
  const endpoint = payload.endpoint || '/api/bedrock'
  let lastErr: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (res.status === 429 || res.status === 503) {
        const waitS = 10 * (attempt + 1)
        lastErr = new Error(`Bedrock rate-limited or service busy (${res.status})`)
        onLog?.(`Bedrock busy (${res.status}) — waiting ${waitS}s, retry ${attempt + 1}/${MAX_RETRIES}…`)
        await sleep(waitS * 1000)
        continue
      }

      const data = await res.json()
      if (!res.ok) {
        const errMsg = data?.error || (await res.text().catch(() => 'Unknown error'))
        throw new Error(`Bedrock API error (${res.status}): ${errMsg}`)
      }

      if (data.error) {
        throw new Error(`Bedrock error: ${data.error}`)
      }

      return data.text || ''
    } catch (e: any) {
      if (e.name === 'TimeoutError') {
        lastErr = new Error(`Bedrock request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)
      } else {
        lastErr = e instanceof Error ? e : new Error(String(e))
      }
      onLog?.(`${lastErr.message} (attempt ${attempt + 1}/${MAX_RETRIES})`)
      if (attempt < MAX_RETRIES - 1) {
        await sleep(2000 * (attempt + 1))
      }
    }
  }

  throw lastErr ?? new Error('Bedrock request failed')
}

function buildEmailPrompt(emails: EmailMessage[], categories: string[]): string {
  const emailBlocks = emails
    .map(
      (e) =>
        `<email id="${e.id}">\nFROM: ${e.from}\nSUBJECT: ${e.subject}\nDATE: ${e.date}\nBODY:\n${e.body.slice(0, 2000)}\n</email>`,
    )
    .join('\n\n')

  return `You are a bank-email parser for a Canadian personal expense tracker.

For EACH email below, return one JSON object in a JSON array.

An email IS a transaction only if it notifies about actual money movement: a card purchase, debit, pre-authorized payment, bill payment, Interac e-Transfer sent/received, refund, or payroll/deposit. It is NOT a transaction if it is: a promotion/offer, statement-ready notice, balance summary, security alert, login/OTP code, or payment *reminder* (money not yet moved). For non-transactions return {"emailId": "...", "isTransaction": false}.

For transactions:
- "emailId": string matching email id attribute
- "isTransaction": true
- "amount": positive dollars as a number (e.g. 43.17)
- "currency": "CAD" (or ISO code mentioned)
- "merchant": clean human name ("TIM HORTONS #4021 TORONTO" → "Tim Hortons"); for e-transfers use the counterparty's name
- "date": the transaction date as YYYY-MM-DD (fall back to email date)
- "direction": "debit" if money left user's account, "credit" if money came in
- "accountHint": the card/account mentioned if any, e.g. "TD Visa ****1234"
- "category": exactly one of: ${categories.join(', ')}
- "confidence": number between 0.0 and 1.0

CATEGORY RULES: Money the user SENDS to another person or through a remittance service (Instarem, Wise, Remitly, Western Union, Interac e-Transfer to a person) is a real expense → use "Money Sent". Reserve "Transfers" ONLY for money moved between the user's own accounts or a payment toward the user's own credit card. Money RECEIVED from another person is a "credit" in category "Transfers".

CRITICAL: Output ONLY a valid JSON array matching the structure above. No intro, no conversational text, no markdown explanations.

Emails:
${emailBlocks}`
}

export async function parseEmailsWithBedrock(
  emails: EmailMessage[],
  categories: string[],
  settings: Settings,
  onProgress?: (done: number, total: number) => void,
  onLog?: (s: string) => void,
): Promise<ParsedEmail[]> {
  const modelId = settings.bedrockModel || 'amazon.nova-lite-v1:0'
  const out: ParsedEmail[] = []

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE)
    onLog?.(`Bedrock (${modelId}): sending batch of ${batch.length} emails…`)

    const prompt = buildEmailPrompt(batch, categories)
    const raw = await callBedrock(
      {
        modelId,
        region: settings.bedrockRegion || 'us-east-1',
        endpoint: settings.bedrockEndpoint,
        accessKeyId: settings.awsAccessKeyId || undefined,
        secretAccessKey: settings.awsSecretAccessKey || undefined,
        sessionToken: settings.awsSessionToken || undefined,
        system: [{ text: 'You are an accurate, deterministic JSON parsing engine for banking transactions.' }],
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { temperature: 0, maxTokens: 4096 },
      },
      onLog,
    )

    const parsed = extractJsonArray<ParsedEmail>(raw)
    out.push(...parsed)
    onProgress?.(Math.min(i + BATCH_SIZE, emails.length), emails.length)
  }

  return out
}

function buildDocPrompt(categories: string[]): string {
  return `You are a bank and credit card statement parser for a personal expense tracker.
The attached content is a bank statement (PDF), CSV/text banking export, or screenshot of transactions.

Extract EVERY individual transaction as a JSON object inside a JSON array.

Each transaction object must include:
- "amount": positive number in dollars (e.g. 43.17, never negative)
- "currency": "CAD" (or ISO code if specified)
- "direction": "debit" for purchases, withdrawals, fees, bill payments; "credit" for refunds, deposits, payroll
- "merchant": clean human name ("SQ *TIM HORTONS 4021" → "Tim Hortons")
- "date": transaction posting date as YYYY-MM-DD
- "category": exactly one of: ${categories.join(', ')}
- "account": card or account label if shown
- "confidence": certainty between 0.0 and 1.0

CATEGORY RULES: Money SENT to another person or via remittance services (Wise, Remitly, Western Union, Interac e-transfer) → "Money Sent". Reserve "Transfers" ONLY for internal movement between user's own accounts or card payments.

IGNORE opening/closing balances, fee/interest summaries, payments due, rewards points, page headers/footers, and subtotals. Return only real transactions.

CRITICAL: Return ONLY a raw JSON array of objects (e.g. [ {"amount": ...} ]). No markdown text outside the JSON.`
}

export async function parseDocumentWithBedrock(
  input: { text: string } | { mimeType: string; base64: string },
  categories: string[],
  settings: Settings,
  onLog?: (s: string) => void,
): Promise<DocTxn[]> {
  const modelId = settings.bedrockModel || 'amazon.nova-lite-v1:0'
  onLog?.(`Bedrock: reading document with ${modelId}…`)

  const content: BedrockMessageContent[] = [{ text: buildDocPrompt(categories) }]

  if ('text' in input) {
    content.push({ text: `\nDOCUMENT CONTENT:\n${input.text.slice(0, 300_000)}` })
  } else {
    const mime = input.mimeType.toLowerCase()
    if (mime.includes('pdf')) {
      content.push({
        document: {
          format: 'pdf',
          name: 'statement_doc',
          base64: input.base64,
        },
      })
    } else if (mime.includes('png')) {
      content.push({ image: { format: 'png', base64: input.base64 } })
    } else if (mime.includes('jpeg') || mime.includes('jpg')) {
      content.push({ image: { format: 'jpeg', base64: input.base64 } })
    } else if (mime.includes('webp')) {
      content.push({ image: { format: 'webp', base64: input.base64 } })
    } else if (mime.includes('gif')) {
      content.push({ image: { format: 'gif', base64: input.base64 } })
    } else if (mime.includes('csv')) {
      content.push({
        document: {
          format: 'csv',
          name: 'statement_csv',
          base64: input.base64,
        },
      })
    } else {
      // Default to PDF document block for binary documents
      content.push({
        document: {
          format: 'pdf',
          name: 'uploaded_document',
          base64: input.base64,
        },
      })
    }
  }

  const raw = await callBedrock(
    {
      modelId,
      region: settings.bedrockRegion || 'us-east-1',
      endpoint: settings.bedrockEndpoint,
      accessKeyId: settings.awsAccessKeyId || undefined,
      secretAccessKey: settings.awsSecretAccessKey || undefined,
      sessionToken: settings.awsSessionToken || undefined,
      system: [{ text: 'You are an accurate, deterministic document parser extracting transaction records into JSON.' }],
      messages: [{ role: 'user', content }],
      inferenceConfig: { temperature: 0, maxTokens: 4096 },
    },
    onLog,
  )

  return extractJsonArray<DocTxn>(raw)
}

export async function askAboutSpendingWithBedrock(
  question: string,
  dataCsv: string,
  settings: Settings,
  onLog?: (s: string) => void,
): Promise<string> {
  const modelId = settings.bedrockModel || 'amazon.nova-lite-v1:0'
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

  return callBedrock(
    {
      modelId,
      region: settings.bedrockRegion || 'us-east-1',
      endpoint: settings.bedrockEndpoint,
      accessKeyId: settings.awsAccessKeyId || undefined,
      secretAccessKey: settings.awsSecretAccessKey || undefined,
      sessionToken: settings.awsSessionToken || undefined,
      system: [{ text: 'You are a concise, helpful personal finance assistant.' }],
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { temperature: 0, maxTokens: 2048 },
    },
    onLog,
  )
}

/** Test Bedrock connectivity, credentials, and Nova Lite response */
export async function testBedrockConnection(
  settings: Settings,
): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const start = performance.now()
  const modelId = settings.bedrockModel || 'amazon.nova-lite-v1:0'

  try {
    const reply = await callBedrock({
      modelId,
      region: settings.bedrockRegion || 'us-east-1',
      endpoint: settings.bedrockEndpoint,
      accessKeyId: settings.awsAccessKeyId || undefined,
      secretAccessKey: settings.awsSecretAccessKey || undefined,
      sessionToken: settings.awsSessionToken || undefined,
      messages: [
        {
          role: 'user',
          content: [{ text: 'Respond with the single word: OK' }],
        },
      ],
      inferenceConfig: { temperature: 0, maxTokens: 10 },
    })

    const latencyMs = Math.round(performance.now() - start)
    return {
      ok: true,
      message: `Connected successfully to ${modelId} (${latencyMs}ms): "${reply.trim()}"`,
      latencyMs,
    }
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start)
    return {
      ok: false,
      message: err.message || String(err),
      latencyMs,
    }
  }
}
