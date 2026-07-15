<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { db, rememberRule } from '../lib/db'
import { useLiveQuery } from '../lib/useLiveQuery'
import { formatCents, monthLabel } from '../lib/money'
import { openEditTxn, openNewTxn } from '../lib/ui'
import { seedDemoData } from '../lib/demo'
import AppSelect from '../components/AppSelect.vue'
import type { Txn } from '../lib/types'

const txns = useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), [] as Txn[])
const categories = useLiveQuery(() => db.categories.orderBy('order').toArray(), [])

const search = ref('')
const fCategory = ref('')
const fAccount = ref('')
const fStatus = ref('')
const fMonth = ref('')
const selecting = ref(false)
const selected = ref(new Set<string>())

const accounts = computed(() =>
  [...new Set(txns.value.map((t) => t.account).filter(Boolean))].sort(),
)
const months = computed(() =>
  [...new Set(txns.value.map((t) => t.date.slice(0, 7)))].sort().reverse(),
)

// options for the themed AppSelect filters
const categoryFilterOptions = computed(() => [
  { value: '', label: 'All categories' },
  ...categories.value.map((c) => ({ value: c.name, label: c.name })),
])
const accountFilterOptions = computed(() => [
  { value: '', label: 'All accounts' },
  ...accounts.value.map((a) => ({ value: a, label: a })),
])
const monthFilterOptions = computed(() => [
  { value: '', label: 'All months' },
  ...months.value.map((m) => ({ value: m, label: monthLabel(m) })),
])
const statusFilterOptions = [
  { value: '', label: 'Any status' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'review', label: 'Needs review' },
]

// bulk recategorize via themed select: pick a category → apply → reset
const recatModel = ref('')
const recatOptions = computed(() => [
  { value: '', label: `Recategorize (${selected.value.size})…` },
  ...categories.value.map((c) => ({ value: c.name, label: `→ ${c.name}` })),
])
watch(recatModel, async (cat) => {
  if (!cat) return
  await recategorizeSelected(cat)
  recatModel.value = ''
})

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim()
  return txns.value.filter((t) => {
    if (fCategory.value && t.category !== fCategory.value) return false
    if (fAccount.value && t.account !== fAccount.value) return false
    if (fStatus.value && t.status !== fStatus.value) return false
    if (fMonth.value && !t.date.startsWith(fMonth.value)) return false
    if (q && !`${t.merchant} ${t.notes ?? ''} ${t.account}`.toLowerCase().includes(q)) return false
    return true
  })
})

const grouped = computed(() => {
  const map = new Map<string, Txn[]>()
  for (const t of filtered.value) {
    if (!map.has(t.date)) map.set(t.date, [])
    map.get(t.date)!.push(t)
  }
  return [...map.entries()]
})

const totalCents = computed(() =>
  filtered.value.reduce(
    (s, t) => s + (t.direction === 'debit' ? t.amountCents : -t.amountCents),
    0,
  ),
)

const hasFilters = computed(
  () => search.value || fCategory.value || fAccount.value || fStatus.value || fMonth.value,
)

function clearFilters() {
  search.value = fCategory.value = fAccount.value = fStatus.value = fMonth.value = ''
}

function rowClick(t: Txn) {
  if (selecting.value) {
    selected.value.has(t.id) ? selected.value.delete(t.id) : selected.value.add(t.id)
    selected.value = new Set(selected.value)
  } else {
    openEditTxn(t)
  }
}

async function deleteSelected() {
  if (!selected.value.size) return
  if (!confirm(`Delete ${selected.value.size} entries?`)) return
  await db.transactions.bulkDelete([...selected.value])
  selected.value = new Set()
  selecting.value = false
}

async function recategorizeSelected(cat: string) {
  if (!cat || !selected.value.size) return
  const rows = await db.transactions.where('id').anyOf([...selected.value]).toArray()
  await db.transactions
    .where('id')
    .anyOf([...selected.value])
    .modify({ category: cat, updatedAt: Date.now() })
  // learn each merchant → category so future imports auto-apply
  const seen = new Set<string>()
  for (const t of rows) {
    if (!seen.has(t.merchant)) {
      seen.add(t.merchant)
      await rememberRule(t.merchant, cat)
    }
  }
  selected.value = new Set()
  selecting.value = false
}

function dateLabel(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-CA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
</script>

<template>
  <div class="max-w-3xl">
    <div class="flex items-baseline justify-between mb-4">
      <h1 class="text-xs uppercase tracking-[0.2em]">Transactions</h1>
      <div class="text-xs text-muted tnum">
        {{ filtered.length }} entries · net {{ formatCents(totalCents) }}
      </div>
    </div>

    <!-- filters -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
      <input v-model="search" placeholder="Search…" class="col-span-2 md:col-span-1" />
      <AppSelect v-model="fCategory" :options="categoryFilterOptions" />
      <AppSelect v-model="fAccount" :options="accountFilterOptions" />
      <AppSelect v-model="fMonth" :options="monthFilterOptions" />
      <AppSelect v-model="fStatus" :options="statusFilterOptions" />
    </div>

    <div class="flex flex-wrap gap-2 mb-4">
      <button v-if="hasFilters" class="btn" @click="clearFilters">Clear filters</button>
      <button class="btn" @click="selecting = !selecting; selected = new Set()">
        {{ selecting ? 'Done' : 'Select' }}
      </button>
      <AppSelect
        v-if="selecting && selected.size"
        v-model="recatModel"
        :options="recatOptions"
        button-class="w-auto! py-1!"
      />
      <button v-if="selecting && selected.size" class="btn btn-accent" @click="deleteSelected">
        Delete ({{ selected.size }})
      </button>
    </div>

    <!-- empty state -->
    <div v-if="txns.length === 0" class="card p-8 text-center text-muted text-xs">
      <p class="mb-4">No entries yet.</p>
      <div class="flex gap-2 justify-center">
        <button class="btn btn-accent" @click="openNewTxn">+ Add one</button>
        <button class="btn" @click="seedDemoData()">Seed demo data</button>
      </div>
    </div>
    <div v-else-if="filtered.length === 0" class="card p-8 text-center text-muted text-xs">
      Nothing matches these filters.
    </div>

    <!-- ledger -->
    <div v-for="[date, rows] in grouped" :key="date" class="mb-5">
      <div class="text-[10px] uppercase tracking-[0.14em] text-muted border-b border-line pb-1 mb-1">
        {{ dateLabel(date) }}
      </div>
      <button
        v-for="t in rows"
        :key="t.id"
        class="w-full flex items-center gap-3 py-2 border-b border-line/60 text-left cursor-pointer hover:bg-paper-2 px-1"
        @click="rowClick(t)"
      >
        <span
          v-if="selecting"
          class="w-4 h-4 border border-line shrink-0 inline-flex items-center justify-center text-[10px]"
          :class="selected.has(t.id) && 'bg-accent border-accent text-paper'"
        >{{ selected.has(t.id) ? '✕' : '' }}</span>
        <span class="flex-1 min-w-0">
          <span class="block truncate">{{ t.merchant }}</span>
          <span class="block text-[10px] uppercase tracking-[0.1em] text-muted truncate">
            {{ t.category }}<template v-if="t.account"> · {{ t.account }}</template>
            <span v-if="t.status === 'review'" class="text-accent"> · review</span>
          </span>
        </span>
        <span
          class="tnum shrink-0"
          :class="t.direction === 'credit' ? 'text-good' : ''"
        >{{ t.direction === 'credit' ? '+' : '−' }}{{ formatCents(t.amountCents) }}</span>
      </button>
    </div>
  </div>
</template>
