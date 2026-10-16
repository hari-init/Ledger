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
  aiProvider: 'bedrock',
  bedrockModel: 'amazon.nova-lite-v1:0',
  bedrockRegion: 'us-east-1',
  bedrockEndpoint: '/api/bedrock',
  awsAccessKeyId: '',
  awsSecretAccessKey: '',
  awsSessionToken: '',
  geminiApiKey: '',
  geminiModel: 'gemini-flash-lite-latest',
  senderFilters: [...DEFAULT_SENDER_FILTERS],
  lookbackDays: 30,
  syncUrl: '',
  syncId: '',
  syncPassphrase: '',
  syncAuto: false,
  lastSyncedVersion: 0,
  lastSyncedAt: 0,
  deviceId: '',
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
      if (!s.aiProvider) {
        s.aiProvider = s.geminiApiKey ? 'gemini' : 'bedrock'
      }
      if (!s.bedrockModel) s.bedrockModel = 'amazon.nova-lite-v1:0'
      if (!s.bedrockRegion) s.bedrockRegion = 'us-east-1'
      const isPages = typeof window !== 'undefined' && window.location.hostname.includes('.pages.dev')
      if (isPages && (!s.bedrockEndpoint || s.bedrockEndpoint === '/api/bedrock')) {
        s.bedrockEndpoint = 'https://ledger-sync.hravi.workers.dev/api/bedrock'
      } else if (!s.bedrockEndpoint) {
        s.bedrockEndpoint = '/api/bedrock'
      }
      if (isPages && !s.syncUrl) {
        s.syncUrl = 'https://ledger-sync.hravi.workers.dev'
      }
      return s
    }
  } catch {
    /* corrupted settings fall back to defaults */
  }
  const s = { ...defaults }
  if (typeof window !== 'undefined' && window.location.hostname.includes('.pages.dev')) {
    s.bedrockEndpoint = 'https://ledger-sync.hravi.workers.dev/api/bedrock'
    s.syncUrl = 'https://ledger-sync.hravi.workers.dev'
  }
  return s
}

export const settings = reactive<Settings>(load())

// give this device a stable label the first time
if (!settings.deviceId) {
  const platform = /iphone|ipad|android/i.test(navigator.userAgent)
    ? 'mobile'
    : 'desktop'
  settings.deviceId = `${platform}-${Math.random().toString(36).slice(2, 6)}`
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('Failed to save settings to localStorage:', e)
  }
}

// Synchronously persist every change to localStorage immediately on every keystroke
watch(
  settings,
  () => saveSettings(),
  { deep: true, flush: 'sync' },
)

// Ensure settings are flushed to localStorage on page refresh or tab close
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', saveSettings)
  window.addEventListener('pagehide', saveSettings)
}
