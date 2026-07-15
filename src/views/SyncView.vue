<script setup lang="ts">
import { computed, ref } from 'vue'
import { db } from '../lib/db'
import { syncState, syncLog as log } from '../lib/syncState'
import { useLiveQuery } from '../lib/useLiveQuery'
import { settings } from '../lib/settings'
import { connectAccount, syncAccount, importParsedEmails, importDocumentTxns } from '../lib/sync'
import { parseEmailsWithGemini, parseDocumentWithGemini } from '../lib/gemini'
import { FIXTURE_EMAILS, mockParseEmails } from '../lib/fixtures'
import { formatCents } from '../lib/money'
import { openEditTxn } from '../lib/ui'
import type { Txn } from '../lib/types'

const accounts = useLiveQuery(() => db.accounts.toArray(), [])
const reviewTxns = useLiveQuery(
  () => db.transactions.where('status').equals('review').reverse().sortBy('date'),
  [] as Txn[],
)

const setupMissing = computed(() => {
  const missing: string[] = []
  if (!settings.oauthClientId) missing.push('Google OAuth Client ID')
  if (!settings.geminiApiKey) missing.push('Gemini API key')
  return missing
})

async function run(fn: () => Promise<unknown>) {
  if (syncState.busy) return
  syncState.busy = true
  try {
    await fn()
  } catch (e) {
    log(`ERROR: ${(e as Error).message}`)
  } finally {
    syncState.busy = false
  }
}

const connect = () =>
  run(async () => {
    const email = await connectAccount()
    log(`connected ${email}`)
  })

const syncOne = (email: string) => run(() => syncAccount(email, log))

// forget the last-sync marker so the next fetch covers the full lookback
// window again — the way to apply newly added sender filters to old mail
const rescan = (email: string) =>
  run(async () => {
    await db.accounts.update(email, { lastSyncAt: null })
    log(`${email}: re-scanning the last ${settings.lookbackDays} days with current sender filters`)
    await syncAccount(email, log)
  })

const syncAll = () =>
  run(async () => {
    // one account failing (popup blocked, revoked grant…) must not kill the rest
    for (const a of accounts.value) {
      try {
        await syncAccount(a.email, log)
      } catch (e) {
        log(`ERROR ${a.email}: ${(e as Error).message}`)
        log(`→ try that account's own Sync button (popups are only allowed right after a click)`)
      }
    }
  })

async function removeAccount(email: string) {
  if (!confirm(`Disconnect ${email}? Imported entries stay.`)) return
  await db.accounts.delete(email)
}

// document upload → Gemini → review queue (needs only a Gemini key, no Gmail)
const fileInput = ref<HTMLInputElement>()

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve((r.result as string).split(',')[1] ?? '')
    r.onerror = () => reject(new Error('Could not read the file'))
    r.readAsDataURL(file)
  })
}

function onFileChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  run(async () => {
    try {
      if (!settings.geminiApiKey) throw new Error('Add your Gemini API key in Settings first')
      if (file.size > 15 * 1024 * 1024)
        throw new Error('File is over 15 MB — split the statement or export a smaller range')
      log(`import: reading ${file.name} (${(file.size / 1024).toFixed(0)} KB)`)
      const isText = /\.(csv|tsv|txt)$/i.test(file.name) || file.type.startsWith('text/')
      const input = isText
        ? { text: await file.text() }
        : { mimeType: file.type || 'application/pdf', base64: await readAsBase64(file) }
      const categories = (await db.categories.orderBy('order').toArray()).map((c) => c.name)
      const parsed = await parseDocumentWithGemini(
        input,
        categories,
        settings.geminiApiKey,
        settings.geminiModel,
        log,
      )
      log(`import: Gemini found ${parsed.length} transactions in ${file.name}`)
      const res = await importDocumentTxns(parsed, `imported from ${file.name}`, categories)
      log(
        `import: ${res.imported} queued for review, ${res.duplicates} duplicates, ${res.skipped} skipped`,
      )
    } finally {
      if (fileInput.value) fileInput.value.value = ''
    }
  })
}

// review queue
const confirmTxn = (t: Txn) =>
  db.transactions.update(t.id, { status: 'confirmed', updatedAt: Date.now() })
const rejectTxn = (t: Txn) => db.transactions.delete(t.id)
const confirmAll = async () => {
  await db.transactions
    .where('status')
    .equals('review')
    .modify({ status: 'confirmed', updatedAt: Date.now() })
}

// dev test harness: fixtures through the real import path
const runFixtures = () =>
  run(async () => {
    const categories = (await db.categories.orderBy('order').toArray()).map((c) => c.name)
    const useGemini = !!settings.geminiApiKey
    log(`fixture sync: ${FIXTURE_EMAILS.length} emails, parser = ${useGemini ? 'Gemini' : 'offline mock'}`)
    const parsed = useGemini
      ? await parseEmailsWithGemini(
          FIXTURE_EMAILS,
          categories,
          settings.geminiApiKey,
          settings.geminiModel,
          undefined,
          log,
        )
      : await mockParseEmails(FIXTURE_EMAILS)
    const res = await importParsedEmails(parsed, FIXTURE_EMAILS, 'fixtures@test.local', categories)
    log(
      `fixture sync: ${res.imported} queued for review, ${res.notTransactions} non-transactions, ${res.duplicates} duplicates`,
    )
  })

async function removeFixtures() {
  const ids = (await db.transactions.toArray())
    .filter((t) => t.sourceEmail === 'fixtures@test.local')
    .map((t) => t.id)
  await db.transactions.bulkDelete(ids)
  log(`removed ${ids.length} fixture entries`)
}

function lastSyncLabel(ts: number | null) {
  if (!ts) return 'never synced'
  return `synced ${new Date(ts).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}`
}
</script>

<template>
  <div class="max-w-3xl">
    <h1 class="text-xs uppercase tracking-[0.2em] mb-4">Email sync</h1>

    <div v-if="setupMissing.length" class="card p-4 mb-5 text-xs leading-relaxed">
      <span class="text-accent uppercase tracking-[0.12em]">Setup needed —</span>
      missing: {{ setupMissing.join(', ') }}.
      <RouterLink to="/settings" class="underline">Finish setup in Settings</RouterLink>.
      You can still try the test harness below with sample emails.
    </div>

    <!-- accounts -->
    <section class="card p-4 mb-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted">Connected Gmail accounts</h2>
        <div class="flex gap-2">
          <button class="btn" :disabled="syncState.busy || !settings.oauthClientId" @click="connect">
            + Connect Gmail
          </button>
          <button
            class="btn btn-accent"
            :disabled="syncState.busy || !accounts.length"
            @click="syncAll"
          >
            {{ syncState.busy ? 'Working…' : 'Sync all' }}
          </button>
        </div>
      </div>
      <p v-if="!accounts.length" class="text-xs text-muted">
        No accounts connected yet.
      </p>
      <div v-for="a in accounts" :key="a.email" class="py-2 border-t border-line/60 text-xs">
        <div class="flex items-center gap-2">
          <span class="flex-1 min-w-0 truncate">{{ a.email }}</span>
          <div class="flex gap-2 shrink-0">
            <button class="btn py-1!" :disabled="syncState.busy" @click="syncOne(a.email)">Sync</button>
            <button
              class="btn py-1!"
              :disabled="syncState.busy"
              title="Fetch the full lookback window again — use after changing sender filters"
              @click="rescan(a.email)"
            >
              Re-scan
            </button>
            <button class="btn py-1!" :disabled="syncState.busy" @click="removeAccount(a.email)">✕</button>
          </div>
        </div>
        <div class="text-muted mt-1">{{ lastSyncLabel(a.lastSyncAt) }}</div>
      </div>
    </section>

    <!-- upload a statement / CSV / receipt -->
    <section class="card p-4 mb-5">
      <div class="flex items-center justify-between mb-2 gap-3">
        <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted">
          Upload a statement, CSV or receipt — no Gmail needed
        </h2>
        <button class="btn btn-accent shrink-0" :disabled="syncState.busy" @click="fileInput?.click()">
          {{ syncState.busy ? 'Working…' : 'Choose file' }}
        </button>
      </div>
      <p class="text-xs text-muted leading-relaxed">
        Upload a bank / credit-card statement (PDF), a CSV export from online banking, or a
        screenshot of a transaction list. Gemini reads it and every transaction lands in the review
        queue below. This is the way to capture history your bank never emailed or texted — and it
        only needs your Gemini API key.
      </p>
      <input
        ref="fileInput"
        type="file"
        accept=".pdf,.csv,.tsv,.txt,image/*"
        class="hidden"
        @change="onFileChosen"
      />
    </section>

    <!-- review queue -->
    <section class="card p-4 mb-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted">
          Review queue ({{ reviewTxns.length }})
        </h2>
        <button v-if="reviewTxns.length" class="btn" @click="confirmAll">Confirm all</button>
      </div>
      <p v-if="!reviewTxns.length" class="text-xs text-muted">
        Nothing to review. Imported transactions land here for a once-over before they count.
      </p>
      <div
        v-for="t in reviewTxns"
        :key="t.id"
        class="flex items-center gap-3 py-2 border-t border-line/60 text-xs"
      >
        <span class="flex-1 min-w-0">
          <span class="block truncate">
            {{ t.merchant }}
            <span class="tnum" :class="t.direction === 'credit' ? 'text-good' : ''">
              {{ t.direction === 'credit' ? '+' : '−' }}{{ formatCents(t.amountCents) }}</span>
          </span>
          <span class="block text-[10px] text-muted truncate uppercase tracking-[0.08em]">
            {{ t.date }} · {{ t.category }}
            <template v-if="t.account"> · {{ t.account }}</template>
            <template v-if="t.confidence !== undefined && t.confidence < 0.8">
              · <span class="text-accent">low confidence</span></template>
          </span>
        </span>
        <button class="btn py-1! btn-accent" title="Confirm" @click="confirmTxn(t)">✓</button>
        <button class="btn py-1!" title="Edit" @click="openEditTxn(t)">Edit</button>
        <button class="btn py-1!" title="Reject" @click="rejectTxn(t)">✕</button>
      </div>
    </section>

    <!-- activity log -->
    <section v-if="syncState.lines.length" class="card p-4 mb-5">
      <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted mb-2">Activity</h2>
      <pre class="text-[11px] leading-relaxed whitespace-pre-wrap text-muted max-h-56 overflow-y-auto">{{ syncState.lines.join('\n') }}</pre>
    </section>

    <!-- test harness -->
    <details class="card p-4">
      <summary class="text-[10px] uppercase tracking-[0.14em] text-muted cursor-pointer select-none">
        Test harness — try the pipeline with sample bank emails
      </summary>
      <p class="text-xs text-muted mt-3 leading-relaxed">
        Runs 10 realistic Canadian alert emails (RBC / TD / Interac / Scotiabank / BMO / CIBC,
        including 2 non-transactions) through the exact same parse → dedupe → review-queue path as
        a real sync. Uses Gemini if your key is set, otherwise an offline mock parser.
      </p>
      <div class="flex flex-wrap gap-2 mt-3">
        <button class="btn btn-accent" :disabled="syncState.busy" @click="runFixtures">
          Run fixture sync
        </button>
        <button class="btn" :disabled="syncState.busy" @click="removeFixtures">Remove fixture entries</button>
      </div>
    </details>
  </div>
</template>
