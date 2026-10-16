import type { EmailMessage, ParsedEmail, DocTxn } from './types'
import { settings } from './settings'
import {
  parseEmailsWithGemini,
  parseDocumentWithGemini,
  askAboutSpending as askGemini,
} from './gemini'
import {
  parseEmailsWithBedrock,
  parseDocumentWithBedrock,
  askAboutSpendingWithBedrock,
  testBedrockConnection,
} from './bedrock'

export function isAiConfigured(): { ok: boolean; reason?: string } {
  if (settings.aiProvider === 'gemini') {
    if (!settings.geminiApiKey) {
      return { ok: false, reason: 'Add your Gemini API key in Settings' }
    }
    return { ok: true }
  }

  // AWS Bedrock: If credentials are in environment or local dev proxy, it's ready.
  // If endpoint is set or AWS keys are set, it's ready.
  return { ok: true }
}

export function getAiDisplayName(): string {
  if (settings.aiProvider === 'bedrock') {
    const model = settings.bedrockModel || 'amazon.nova-lite-v1:0'
    if (model.includes('nova-lite')) return 'Amazon Nova Lite'
    if (model.includes('nova-micro')) return 'Amazon Nova Micro'
    if (model.includes('nova-pro')) return 'Amazon Nova Pro'
    return `Bedrock (${model})`
  }
  return `Gemini (${settings.geminiModel})`
}

export async function parseEmails(
  emails: EmailMessage[],
  categories: string[],
  onProgress?: (done: number, total: number) => void,
  onLog?: (s: string) => void,
): Promise<ParsedEmail[]> {
  if (settings.aiProvider === 'bedrock') {
    return parseEmailsWithBedrock(emails, categories, settings, onProgress, onLog)
  }
  return parseEmailsWithGemini(
    emails,
    categories,
    settings.geminiApiKey,
    settings.geminiModel,
    onProgress,
    onLog,
  )
}

export async function parseDocument(
  input: { text: string } | { mimeType: string; base64: string },
  categories: string[],
  onLog?: (s: string) => void,
): Promise<DocTxn[]> {
  if (settings.aiProvider === 'bedrock') {
    return parseDocumentWithBedrock(input, categories, settings, onLog)
  }
  return parseDocumentWithGemini(
    input,
    categories,
    settings.geminiApiKey,
    settings.geminiModel,
    onLog,
  )
}

export async function askAboutSpending(
  question: string,
  dataCsv: string,
): Promise<string> {
  if (settings.aiProvider === 'bedrock') {
    return askAboutSpendingWithBedrock(question, dataCsv, settings)
  }
  return askGemini(question, dataCsv, settings.geminiApiKey, settings.geminiModel)
}

export async function testActiveAi(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  if (settings.aiProvider === 'bedrock') {
    return testBedrockConnection(settings)
  }
  const start = performance.now()
  try {
    const reply = await askGemini('Respond with the single word: OK', 'date,merchant,category,direction,amount', settings.geminiApiKey, settings.geminiModel)
    const latencyMs = Math.round(performance.now() - start)
    return { ok: true, message: `Connected to Gemini (${latencyMs}ms): "${reply.trim()}"`, latencyMs }
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start)
    return { ok: false, message: err.message || String(err), latencyMs }
  }
}
