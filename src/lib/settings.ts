import { reactive, watch } from 'vue'
import type { Settings } from './types'

const KEY = 'ledger.settings'

/** Canadian bank / payment alert senders; user-editable in Settings */
export const DEFAULT_SENDER_FILTERS = [
  'notify@payments.interac.ca',
  'rbc.com',
  'td.com',
  'scotiabank.com',
  'bmo.com',
  'cibc.com',
  'tangerine.ca',
  'amex.ca',
  'capitalone.com',
  'wealthsimple.com',
]

const defaults: Settings = {
  oauthClientId: '',
  geminiApiKey: '',
  geminiModel: 'gemini-flash-lite-latest',
  senderFilters: [...DEFAULT_SENDER_FILTERS],
  lookbackDays: 30,
}

// models Google has retired for new API keys → the alias that replaces them
const MODEL_MIGRATIONS: Record<string, string> = {
  'gemini-2.5-flash-lite': 'gemini-flash-lite-latest',
  'gemini-2.5-flash': 'gemini-flash-latest',
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s: Settings = { ...defaults, ...JSON.parse(raw) }
      s.geminiModel = MODEL_MIGRATIONS[s.geminiModel] ?? s.geminiModel
      return s
    }
  } catch {
    /* corrupted settings fall back to defaults */
  }
  return { ...defaults }
}

export const settings = reactive<Settings>(load())

watch(
  settings,
  (v) => localStorage.setItem(KEY, JSON.stringify(v)),
  { deep: true },
)
