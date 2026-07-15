<script setup lang="ts">
import { computed, ref } from 'vue'
import { db } from '../lib/db'
import { useLiveQuery } from '../lib/useLiveQuery'
import { settings, DEFAULT_SENDER_FILTERS } from '../lib/settings'
import { listGeminiModels } from '../lib/gemini'
import { seedDemoData, removeDemoData } from '../lib/demo'
import { parseToCents, formatCents } from '../lib/money'
import AppSelect from '../components/AppSelect.vue'
import {
  pushToCloud,
  pullFromCloud,
  isConfigured,
  newSyncId,
  syncStatus,
} from '../lib/cloudSync'

const categories = useLiveQuery(() => db.categories.orderBy('order').toArray(), [])
const rules = useLiveQuery(() => db.rules.orderBy('merchant').toArray(), [])
const deleteRule = (merchant: string) => db.rules.delete(merchant)

// cloud sync
const showPass = ref(false)
function genSyncId() {
  settings.syncId = newSyncId()
}
async function doPush() {
  try {
    await pushToCloud()
    flash('Ledger pushed to the cloud')
  } catch (e) {
    flash((e as Error).message)
  }
}
async function doPull(force = false) {
  try {
    const r = await pullFromCloud(force)
    flash(r === 'applied' ? 'Pulled latest from the cloud' : r === 'empty' ? 'Nothing in the cloud yet' : 'Already up to date')
  } catch (e) {
    flash((e as Error).message)
  }
}
function lastSyncedLabel() {
  if (!settings.lastSyncedAt) return 'never synced'
  return `last synced ${new Date(settings.lastSyncedAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })} · this device: ${settings.deviceId}`
}
const status = ref('')
const flash = (s: string) => {
  status.value = s
  setTimeout(() => (status.value = ''), 4000)
}

// model picker: -latest aliases always work; "Fetch models" shows what this key can use
const modelOptions = ref<string[]>([])
const modelChoices = computed(() => {
  const base = new Set(['gemini-flash-lite-latest', 'gemini-flash-latest', settings.geminiModel])
  for (const m of modelOptions.value) base.add(m)
  return [...base]
})
const modelSelectOptions = computed(() => modelChoices.value.map((m) => ({ value: m, label: m })))
async function loadModels() {
  try {
    modelOptions.value = (await listGeminiModels(settings.geminiApiKey)).filter((m) =>
      /flash|lite/.test(m),
    )
    flash(`Found ${modelOptions.value.length} usable models`)
  } catch (e) {
    flash((e as Error).message)
  }
}

// sender filters as editable text
const senderText = computed({
  get: () => settings.senderFilters.join('\n'),
  set: (v: string) =>
    (settings.senderFilters = v.split('\n').map((s) => s.trim()).filter(Boolean)),
})
const resetSenders = () => (settings.senderFilters = [...DEFAULT_SENDER_FILTERS])

// categories
const newCategory = ref('')
async function addCategory() {
  const name = newCategory.value.trim()
  if (!name) return
  if (categories.value.some((c) => c.name.toLowerCase() === name.toLowerCase()))
    return flash('Category already exists')
  await db.categories.add({ name, budgetCents: 0, order: categories.value.length })
  newCategory.value = ''
}
async function removeCategory(name: string) {
  const used = await db.transactions.where('category').equals(name).count()
  if (used > 0 && !confirm(`${used} entries use "${name}" — they'll keep the label. Remove it from the list?`)) return
  await db.categories.delete(name)
}
async function setBudget(name: string, e: Event) {
  const cents = parseToCents((e.target as HTMLInputElement).value) ?? 0
  await db.categories.update(name, { budgetCents: Math.max(0, cents) })
}

// data management
async function exportJson() {
  const data = {
    exportedAt: new Date().toISOString(),
    transactions: await db.transactions.toArray(),
    categories: await db.categories.toArray(),
    accounts: await db.accounts.toArray(),
    rules: await db.rules.toArray(),
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `ledger-export-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

const importInput = ref<HTMLInputElement>()
async function importJson(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const data = JSON.parse(await file.text())
    if (!Array.isArray(data.transactions)) throw new Error('no transactions array')
    await db.transactions.bulkPut(data.transactions)
    if (Array.isArray(data.categories)) await db.categories.bulkPut(data.categories)
    if (Array.isArray(data.rules)) await db.rules.bulkPut(data.rules)
    flash(`Imported ${data.transactions.length} entries`)
  } catch (err) {
    flash(`Import failed: ${(err as Error).message}`)
  } finally {
    if (importInput.value) importInput.value.value = ''
  }
}

async function seedDemo() {
  const n = await seedDemoData()
  flash(`Seeded ${n} demo entries`)
}
async function removeDemo() {
  const n = await removeDemoData()
  flash(`Removed ${n} demo entries`)
}

async function wipeAll() {
  if (!confirm('Delete ALL data on this device (transactions, accounts, categories)?')) return
  if (!confirm('Really sure? There is no undo. Export first if in doubt.')) return
  await Promise.all([
    db.transactions.clear(),
    db.accounts.clear(),
    db.categories.clear(),
    db.rules.clear(),
  ])
  location.reload()
}

const origin = location.origin
</script>

<template>
  <div class="max-w-3xl">
    <h1 class="text-xs uppercase tracking-[0.2em] mb-4">Settings</h1>
    <p v-if="status" class="text-xs text-accent mb-3">{{ status }}</p>

    <!-- setup wizard -->
    <section class="card p-4 mb-5">
      <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted mb-3">
        One-time setup — everything here is free
      </h2>

      <details class="mb-3" open>
        <summary class="text-xs cursor-pointer select-none">
          <span class="text-accent">1.</span> Google OAuth Client ID — lets the app read your Gmail
        </summary>
        <ol class="text-xs text-muted leading-relaxed list-decimal ml-5 mt-2 space-y-1">
          <li>
            Go to
            <a class="underline" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">console.cloud.google.com/projectcreate</a>
            and create a project (any name, e.g. "ledger").
          </li>
          <li>
            In <em>APIs &amp; Services → Library</em>, search "Gmail API" and click
            <em>Enable</em>.
          </li>
          <li>
            In <em>APIs &amp; Services → OAuth consent screen</em>: choose <em>External</em>, fill
            the app name + your email, and under <em>Test users</em> add
            <strong>every Gmail address you want to sync</strong>. Leave it in Testing mode —
            that's fine for personal use and skips Google's verification.
          </li>
          <li>
            In <em>APIs &amp; Services → Credentials</em>: Create credentials → OAuth client ID →
            type <em>Web application</em>. Under <em>Authorized JavaScript origins</em> add
            <code class="text-ink">{{ origin }}</code> (and your deployed URL later).
          </li>
          <li>Copy the Client ID (ends in <code>.apps.googleusercontent.com</code>) below.</li>
        </ol>
        <label class="label mt-3">OAuth Client ID</label>
        <input
          v-model.trim="settings.oauthClientId"
          placeholder="1234567890-xxxx.apps.googleusercontent.com"
          autocomplete="off"
        />
      </details>

      <details class="mb-3">
        <summary class="text-xs cursor-pointer select-none">
          <span class="text-accent">2.</span> Gemini API key — parses emails into expenses
        </summary>
        <ol class="text-xs text-muted leading-relaxed list-decimal ml-5 mt-2 space-y-1">
          <li>
            Go to
            <a class="underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>
            and click <em>Create API key</em> (free tier, no card needed).
          </li>
          <li>Paste it below. It is stored only in this browser.</li>
        </ol>
        <label class="label mt-3">Gemini API key</label>
        <input
          v-model.trim="settings.geminiApiKey"
          type="password"
          placeholder="AIza…"
          autocomplete="off"
        />
        <div class="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label class="label">Model</label>
            <AppSelect v-model="settings.geminiModel" :options="modelSelectOptions" />
            <button class="btn py-1! mt-1.5" @click="loadModels">
              Fetch models my key can use
            </button>
          </div>
          <div>
            <label class="label">First-sync lookback (days)</label>
            <input v-model.number="settings.lookbackDays" type="number" min="1" max="365" />
          </div>
        </div>
      </details>

      <details>
        <summary class="text-xs cursor-pointer select-none">
          <span class="text-accent">3.</span> Turn on bank email alerts
        </summary>
        <p class="text-xs text-muted leading-relaxed mt-2">
          In each bank's app, enable transaction alert emails (RBC Alerts, TD Alerts, Scotia
          InfoAlerts, BMO Alerts, CIBC alerts…). The more alerts your inbox gets, the more complete
          this ledger is. Interac e-Transfer notifications are on by default.
        </p>
      </details>
    </section>

    <!-- sender filters -->
    <section class="card p-4 mb-5">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted">
          Email senders to scan (one per line)
        </h2>
        <button class="btn py-1!" @click="resetSenders">Reset to defaults</button>
      </div>
      <textarea v-model="senderText" rows="6" spellcheck="false" class="text-xs"></textarea>
      <p class="text-[10px] text-muted mt-1">
        Domains (rbc.com) or full addresses (notify@payments.interac.ca). Only mail from these
        senders is ever read.
      </p>
    </section>

    <!-- categories + budgets -->
    <section class="card p-4 mb-5">
      <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted mb-2">
        Categories &amp; monthly budgets
      </h2>
      <div
        v-for="c in categories"
        :key="c.name"
        class="flex items-center gap-2 py-1.5 border-t border-line/60 text-xs"
      >
        <span class="flex-1">{{ c.name }}</span>
        <input
          class="w-28! text-right tnum py-1!"
          :value="c.budgetCents ? (c.budgetCents / 100).toFixed(0) : ''"
          placeholder="budget $"
          inputmode="numeric"
          @change="setBudget(c.name, $event)"
        />
        <button class="btn py-1!" @click="removeCategory(c.name)">✕</button>
      </div>
      <div class="flex gap-2 mt-3">
        <input v-model="newCategory" placeholder="New category" @keydown.enter="addCategory" />
        <button class="btn" @click="addCategory">Add</button>
      </div>
    </section>

    <!-- learned auto-categorization rules -->
    <section class="card p-4 mb-5">
      <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted mb-1">
        Auto-categorize rules ({{ rules.length }})
      </h2>
      <p class="text-[10px] text-muted mb-2 leading-relaxed">
        Learned automatically when you set a category. Future imports of the same merchant get
        this category without asking.
      </p>
      <p v-if="!rules.length" class="text-xs text-muted">
        No rules yet — categorize a transaction and it'll be remembered here.
      </p>
      <div
        v-for="r in rules"
        :key="r.merchant"
        class="flex items-center gap-2 py-1.5 border-t border-line/60 text-xs"
      >
        <span class="flex-1 min-w-0 truncate">{{ r.merchant }}</span>
        <span class="text-muted">→ {{ r.category }}</span>
        <button class="btn py-1!" @click="deleteRule(r.merchant)">✕</button>
      </div>
    </section>

    <!-- data -->
    <section class="card p-4">
      <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted mb-3">Data</h2>
      <div class="flex flex-wrap gap-2">
        <button class="btn" @click="exportJson">Export JSON</button>
        <button class="btn" @click="importInput?.click()">Import JSON</button>
        <input ref="importInput" type="file" accept=".json" class="hidden" @change="importJson" />
        <button class="btn" @click="seedDemo">Seed demo data</button>
        <button class="btn" @click="removeDemo">Remove demo data</button>
        <button class="btn text-accent!" @click="wipeAll">Wipe everything</button>
      </div>
      <p class="text-[10px] text-muted mt-3 leading-relaxed">
        Everything lives in this browser (IndexedDB + localStorage). Export regularly if you care
        about the history — clearing site data clears the ledger. Budget for this app: {{ formatCents(0) }}.
      </p>
    </section>

    <!-- cloud sync -->
    <section class="card p-4 mt-5">
      <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted mb-1">
        Cloud sync (end-to-end encrypted)
      </h2>
      <p class="text-[10px] text-muted mb-3 leading-relaxed">
        Optional. Sync your ledger across devices through your own free Cloudflare Worker. Your data
        is encrypted with your passphrase <em>before</em> it leaves this device — the server only
        ever stores ciphertext. Deploy steps are in <code>worker/README.md</code>.
      </p>

      <label class="label">Worker URL</label>
      <input
        v-model.trim="settings.syncUrl"
        placeholder="https://ledger-sync.you.workers.dev"
        autocomplete="off"
      />

      <label class="label mt-3">Sync ID (keep secret — it's the access key)</label>
      <div class="flex gap-2">
        <input v-model.trim="settings.syncId" placeholder="generate or paste" autocomplete="off" />
        <button class="btn shrink-0" @click="genSyncId">Generate</button>
      </div>

      <label class="label mt-3">Passphrase (encrypts your data; lose it = unrecoverable)</label>
      <div class="flex gap-2">
        <input
          v-model="settings.syncPassphrase"
          :type="showPass ? 'text' : 'password'"
          placeholder="a long passphrase"
          autocomplete="off"
        />
        <button class="btn shrink-0" @click="showPass = !showPass">{{ showPass ? 'Hide' : 'Show' }}</button>
      </div>

      <label class="flex items-center gap-2 mt-3 text-xs cursor-pointer">
        <input type="checkbox" v-model="settings.syncAuto" class="w-auto!" />
        Auto sync — pull on open, push a few seconds after any change
      </label>

      <div class="flex flex-wrap gap-2 mt-3">
        <button class="btn btn-accent" :disabled="syncStatus.busy || !isConfigured()" @click="doPush">
          {{ syncStatus.busy ? 'Working…' : 'Push now' }}
        </button>
        <button class="btn" :disabled="syncStatus.busy || !isConfigured()" @click="doPull(false)">
          Pull now
        </button>
        <button
          class="btn"
          :disabled="syncStatus.busy || !isConfigured()"
          title="Overwrite this device with the cloud copy (use when setting up a new device)"
          @click="doPull(true)"
        >
          Force pull
        </button>
      </div>

      <p class="text-[10px] text-muted mt-2">{{ lastSyncedLabel() }}</p>
      <p v-if="syncStatus.error" class="text-[10px] text-accent mt-1">{{ syncStatus.error }}</p>
      <p class="text-[10px] text-muted mt-2 leading-relaxed">
        Conflicts are last-write-wins on the whole ledger — fine for one person across a couple of
        devices. On a new device, set the same URL / ID / passphrase and use <strong>Force pull</strong>.
      </p>
    </section>
  </div>
</template>
