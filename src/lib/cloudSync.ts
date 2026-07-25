import { reactive } from 'vue'
import { db } from './db'
import { settings } from './settings'
import { encryptJSON, decryptJSON, type EncryptedBlob } from './crypto'
import type { Txn, Category, GmailAccount, MerchantRule } from './types'

interface Snapshot {
  transactions: Txn[]
  categories: Category[]
  accounts: GmailAccount[]
  rules: MerchantRule[]
}

/** what the Worker stores, keyed by syncId. `blob` is opaque ciphertext to the server. */
interface CloudPayload {
  version: number
  device: string
  blob: EncryptedBlob
}

export const syncStatus = reactive<{ busy: boolean; message: string; error: string }>({
  busy: false,
  message: '',
  error: '',
})

// suppress the auto-push hooks while we are writing pulled data locally
let suppressPush = false
let pushTimer: ReturnType<typeof setTimeout> | null = null

export function isConfigured(): boolean {
  return !!(settings.syncUrl && settings.syncId && settings.syncPassphrase)
}

function endpoint(): string {
  return `${settings.syncUrl.replace(/\/+$/, '')}/${encodeURIComponent(settings.syncId)}`
}

async function snapshot(): Promise<Snapshot> {
  const [transactions, categories, accounts, rules] = await Promise.all([
    db.transactions.toArray(),
    db.categories.toArray(),
    db.accounts.toArray(),
    db.rules.toArray(),
  ])
  return { transactions, categories, accounts, rules }
}

async function restore(snap: Snapshot): Promise<void> {
  suppressPush = true
  try {
    await db.transaction('rw', db.transactions, db.categories, db.accounts, db.rules, async () => {
      await Promise.all([
        db.transactions.clear(),
        db.categories.clear(),
        db.accounts.clear(),
        db.rules.clear(),
      ])
      if (snap.transactions?.length) await db.transactions.bulkPut(snap.transactions)
      if (snap.categories?.length) await db.categories.bulkPut(snap.categories)
      if (snap.accounts?.length) await db.accounts.bulkPut(snap.accounts)
      if (snap.rules?.length) await db.rules.bulkPut(snap.rules)
    })
  } finally {
    suppressPush = false
  }
}

/** Encrypt the whole ledger and upload it (last-write-wins). */
export async function pushToCloud(): Promise<void> {
  if (!isConfigured()) throw new Error('Cloud sync is not set up — see Settings')
  syncStatus.busy = true
  syncStatus.error = ''
  try {
    const blob = await encryptJSON(await snapshot(), settings.syncPassphrase)
    const version = Date.now()
    const payload: CloudPayload = { version, device: settings.deviceId, blob }
    const r = await fetch(endpoint(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!r.ok) throw new Error(`Upload failed (${r.status}): ${(await r.text()).slice(0, 200)}`)
    settings.lastSyncedVersion = version
    settings.lastSyncedAt = Date.now()
    syncStatus.message = 'Pushed'
  } catch (e) {
    syncStatus.error = (e as Error).message
    throw e
  } finally {
    syncStatus.busy = false
  }
}

/**
 * Download and apply the cloud copy if it's newer than what this device last synced.
 * Pass force to overwrite local regardless (e.g. first setup on a fresh device).
 */
export async function pullFromCloud(force = false): Promise<'applied' | 'up-to-date' | 'empty'> {
  if (!isConfigured()) throw new Error('Cloud sync is not set up — see Settings')
  syncStatus.busy = true
  syncStatus.error = ''
  try {
    const r = await fetch(endpoint())
    if (r.status === 404) {
      syncStatus.message = 'Nothing in the cloud yet'
      return 'empty'
    }
    if (!r.ok) throw new Error(`Download failed (${r.status})`)
    const payload = (await r.json()) as CloudPayload
    if (!payload?.blob) return 'empty'
    if (!force && payload.version <= settings.lastSyncedVersion) {
      syncStatus.message = 'Already up to date'
      return 'up-to-date'
    }
    const snap = await decryptJSON<Snapshot>(payload.blob, settings.syncPassphrase)
    await restore(snap)
    settings.lastSyncedVersion = payload.version
    settings.lastSyncedAt = Date.now()
    syncStatus.message = 'Pulled latest'
    return 'applied'
  } catch (e) {
    syncStatus.error = (e as Error).message
    throw e
  } finally {
    syncStatus.busy = false
  }
}

// ---- auto-sync ----

function schedulePush() {
  if (suppressPush || !settings.syncAuto || !isConfigured()) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushToCloud().catch(() => {
      /* error already surfaced on syncStatus */
    })
  }, 4000)
}

// pull the latest when the app becomes active again (throttled), so a device
// left open still picks up edits made on another device without a manual reload
let lastAutoPull = 0
function maybeAutoPull() {
  if (!settings.syncAuto || !isConfigured() || syncStatus.busy) return
  if (document.visibilityState !== 'visible') return
  if (Date.now() - lastAutoPull < 8000) return
  lastAutoPull = Date.now()
  pullFromCloud().catch(() => {
    /* offline / not reachable — surfaced on syncStatus */
  })
}

let hooksInstalled = false
/**
 * Call once at startup. Installs auto-push hooks and, when Auto sync is on,
 * pulls the latest on open and whenever the app regains focus.
 */
export async function initCloudSync(): Promise<void> {
  if (!hooksInstalled) {
    hooksInstalled = true
    for (const table of [db.transactions, db.categories, db.accounts, db.rules]) {
      table.hook('creating', schedulePush)
      table.hook('updating', schedulePush)
      table.hook('deleting', schedulePush)
    }
    document.addEventListener('visibilitychange', maybeAutoPull)
    window.addEventListener('focus', maybeAutoPull)
  }
  if (settings.syncAuto && isConfigured()) {
    lastAutoPull = Date.now()
    try {
      await pullFromCloud()
    } catch {
      /* offline / not reachable — surfaced on syncStatus, retry on next open */
    }
  }
}

export function newSyncId(): string {
  return (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, '')
}
