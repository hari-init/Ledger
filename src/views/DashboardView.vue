<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { db } from '../lib/db'
import { useLiveQuery } from '../lib/useLiveQuery'
import { formatCents, lastMonthKeys, monthKey, monthLabel } from '../lib/money'
import { seedDemoData } from '../lib/demo'
import { openNewTxn } from '../lib/ui'
import AppSelect from '../components/AppSelect.vue'
import type { Txn } from '../lib/types'

const txns = useLiveQuery(
  () => db.transactions.where('status').equals('confirmed').toArray(),
  [] as Txn[],
)
const categories = useLiveQuery(() => db.categories.orderBy('order').toArray(), [])

const months = computed(() => {
  const present = new Set(txns.value.map((t) => t.date.slice(0, 7)))
  present.add(monthKey(new Date()))
  return [...present].sort().reverse()
})
const selMonth = ref(monthKey(new Date()))
const monthOptions = computed(() => months.value.map((m) => ({ value: m, label: monthLabel(m) })))

// when off, Transfers (money between own accounts / sent) are excluded everywhere;
// when on, every panel counts them too. Persisted so it sticks between visits.
const includeTransfers = ref(localStorage.getItem('ledger.includeTransfers') === '1')
watch(includeTransfers, (v) => localStorage.setItem('ledger.includeTransfers', v ? '1' : '0'))
const keep = (t: Txn) => includeTransfers.value || t.category !== 'Transfers'

const inMonth = computed(() => txns.value.filter((t) => t.date.startsWith(selMonth.value)))
const spent = (list: Txn[]) =>
  list.filter((t) => t.direction === 'debit' && keep(t)).reduce((s, t) => s + t.amountCents, 0)
const earned = (list: Txn[]) =>
  list.filter((t) => t.direction === 'credit' && keep(t)).reduce((s, t) => s + t.amountCents, 0)

const spentThis = computed(() => spent(inMonth.value))
const earnedThis = computed(() => earned(inMonth.value))

const prevMonthKey = computed(() => {
  const [y, m] = selMonth.value.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})
const spentPrev = computed(() =>
  spent(txns.value.filter((t) => t.date.startsWith(prevMonthKey.value))),
)
const delta = computed(() => (spentPrev.value ? spentThis.value - spentPrev.value : null))

// ----- 12-month trend -----
const trend = computed(() => {
  const [y, m] = selMonth.value.split('-').map(Number)
  const keys = lastMonthKeys(12, new Date(y, m - 1, 1))
  const byMonth = new Map(keys.map((k) => [k, 0]))
  for (const t of txns.value) {
    const k = t.date.slice(0, 7)
    if (byMonth.has(k) && t.direction === 'debit' && keep(t)) {
      byMonth.set(k, byMonth.get(k)! + t.amountCents)
    }
  }
  return keys.map((k) => ({ key: k, label: monthLabel(k).split(' ')[0], cents: byMonth.get(k)! }))
})
const trendMax = computed(() => {
  const max = Math.max(...trend.value.map((b) => b.cents), 1)
  // round up to a clean tick value
  const mag = 10 ** (String(Math.ceil(max / 100)).length - 1)
  return Math.ceil(max / 100 / mag) * mag * 100
})
const hover = ref<{ key: string; label: string; cents: number } | null>(null)

// ----- category breakdown for selected month -----
const byCategory = computed(() => {
  const map = new Map<string, number>()
  for (const t of inMonth.value) {
    if (t.direction !== 'debit' || !keep(t)) continue
    map.set(t.category, (map.get(t.category) ?? 0) + t.amountCents)
  }
  const budgets = new Map(categories.value.map((c) => [c.name, c.budgetCents]))
  return [...map.entries()]
    .map(([name, cents]) => ({ name, cents, budget: budgets.get(name) ?? 0 }))
    .sort((a, b) => b.cents - a.cents)
})
const catMax = computed(() => Math.max(...byCategory.value.map((c) => Math.max(c.cents, c.budget)), 1))

// ----- top sources / largest, for either direction (Transfers excluded) -----
function topBy(dir: 'debit' | 'credit') {
  const map = new Map<string, { cents: number; n: number }>()
  for (const t of inMonth.value) {
    if (t.direction !== dir || !keep(t)) continue
    const cur = map.get(t.merchant) ?? { cents: 0, n: 0 }
    cur.cents += t.amountCents
    cur.n++
    map.set(t.merchant, cur)
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 6)
}
function largestBy(dir: 'debit' | 'credit') {
  return [...inMonth.value]
    .filter((t) => t.direction === dir && keep(t))
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 5)
}

const topMerchants = computed(() => topBy('debit'))
const largest = computed(() => largestBy('debit'))
const topIncomeSources = computed(() => topBy('credit'))
const largestIncome = computed(() => largestBy('credit'))

// ----- recurring / subscriptions (whole history) -----
const recurring = computed(() => {
  const groups = new Map<string, Txn[]>()
  for (const t of txns.value) {
    if (t.direction !== 'debit' || t.category === 'Transfers') continue
    const k = t.merchant.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(t)
  }
  const out: { merchant: string; category: string; amountCents: number; last: string; next: string }[] = []
  for (const list of groups.values()) {
    const months = new Set(list.map((t) => t.date.slice(0, 7)))
    if (months.size < 3) continue // must recur across ≥3 distinct months
    if (list.length > months.size + 1) continue // ~one charge per month (skip groceries etc.)
    const amts = list.map((t) => t.amountCents).sort((a, b) => a - b)
    const median = amts[Math.floor(amts.length / 2)]
    // true subscriptions bill a near-identical amount each period; a merchant with
    // variable spend (groceries, shopping) is not recurring even if monthly
    const consistent = amts.filter((a) => Math.abs(a - median) <= median * 0.08).length
    if (consistent < list.length * 0.7) continue
    const latest = [...list].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!
    const d = new Date(latest.date + 'T12:00:00')
    d.setMonth(d.getMonth() + 1)
    out.push({
      merchant: latest.merchant,
      category: latest.category,
      amountCents: median,
      last: latest.date,
      next: d.toISOString().slice(0, 10),
    })
  }
  return out.sort((a, b) => b.amountCents - a.amountCents)
})
const recurringMonthly = computed(() =>
  recurring.value.reduce((s, r) => s + r.amountCents, 0),
)

// ----- month-over-month insights -----
type Insight = { text: string; tone: 'up' | 'down' | 'warn' }
const insights = computed(() => {
  const out: Insight[] = []
  const prevKey = prevMonthKey.value
  const catThis = new Map<string, number>()
  const catPrev = new Map<string, number>()
  const merchMonths = new Map<string, Set<string>>()
  for (const t of txns.value) {
    if (t.direction !== 'debit' || !keep(t)) continue
    const mk = t.date.slice(0, 7)
    const key = t.merchant.toLowerCase().trim()
    if (!merchMonths.has(key)) merchMonths.set(key, new Set())
    merchMonths.get(key)!.add(mk)
    if (mk === selMonth.value) catThis.set(t.category, (catThis.get(t.category) ?? 0) + t.amountCents)
    else if (mk === prevKey) catPrev.set(t.category, (catPrev.get(t.category) ?? 0) + t.amountCents)
  }
  // biggest category swings vs last month
  const swings: Insight[] = []
  for (const [cat, now] of catThis) {
    const before = catPrev.get(cat) ?? 0
    if (before > 0 && Math.abs(now - before) >= 2000) {
      const pct = Math.round(((now - before) / before) * 100)
      if (Math.abs(pct) >= 25)
        swings.push({
          text: `${cat} ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% vs ${monthLabel(prevKey)}`,
          tone: pct > 0 ? 'up' : 'down',
        })
    }
  }
  out.push(...swings.slice(0, 3))
  // over budget
  for (const c of byCategory.value) {
    if (c.budget && c.cents > c.budget)
      out.push({ text: `Over budget: ${c.name} at ${formatCents(c.cents)} of ${formatCents(c.budget, true)}`, tone: 'warn' })
  }
  // notable new merchant this month (unseen in prior months)
  const newOnes = topMerchants.value.filter((m) => {
    const seen = merchMonths.get(m.name.toLowerCase().trim())
    return seen && seen.size === 1 && seen.has(selMonth.value)
  })
  if (newOnes[0])
    out.push({ text: `New merchant: ${newOnes[0].name} (${formatCents(newOnes[0].cents)})`, tone: 'up' })
  return out.slice(0, 5)
})

async function seed() {
  await seedDemoData()
}
</script>

<template>
  <div class="max-w-3xl">
    <div class="flex items-center justify-between mb-5 gap-3">
      <h1 class="text-xs uppercase tracking-[0.2em]">Dashboard</h1>
      <div class="flex items-center gap-2">
        <button
          class="btn py-1.5! text-xs!"
          :class="includeTransfers ? 'btn-accent' : ''"
          title="Include transfers (money between your own accounts / sent) in every total"
          @click="includeTransfers = !includeTransfers"
        >
          {{ includeTransfers ? '✓ ' : '' }}Transfers
        </button>
        <AppSelect
          v-model="selMonth"
          :options="monthOptions"
          align="right"
          button-class="w-auto! py-1.5! text-xs!"
        />
      </div>
    </div>

    <!-- empty state -->
    <div v-if="txns.length === 0" class="card p-8 text-center text-muted text-xs">
      <p class="mb-1">Nothing here yet.</p>
      <p class="mb-4">Add an expense, run a sync, or look around with demo data.</p>
      <div class="flex gap-2 justify-center">
        <button class="btn btn-accent" @click="openNewTxn">+ Add expense</button>
        <button class="btn" @click="seed">Seed demo data</button>
      </div>
    </div>

    <template v-else>
      <!-- stat tiles -->
      <div class="grid grid-cols-2 md:grid-cols-3 gap-2 mb-5">
        <div class="card p-4 col-span-2 md:col-span-1">
          <div class="label mb-0!">Spent · {{ monthLabel(selMonth) }}</div>
          <div class="text-[34px] leading-tight font-semibold mt-1">
            {{ formatCents(spentThis, true) }}
          </div>
          <div v-if="delta !== null" class="text-[11px] mt-1" :class="delta > 0 ? 'text-accent' : 'text-good'">
            {{ delta > 0 ? '▲' : '▼' }} {{ formatCents(Math.abs(delta), true) }} vs {{ monthLabel(prevMonthKey) }}
          </div>
        </div>
        <div class="card p-4">
          <div class="label mb-0!">Income</div>
          <div class="text-xl font-semibold mt-1">{{ formatCents(earnedThis, true) }}</div>
          <div class="text-[11px] text-muted mt-1">excl. transfers</div>
        </div>
        <div class="card p-4">
          <div class="label mb-0!">Net</div>
          <div
            class="text-xl font-semibold mt-1"
            :class="earnedThis - spentThis >= 0 ? 'text-good' : 'text-accent'"
          >
            {{ formatCents(earnedThis - spentThis, true) }}
          </div>
          <div class="text-[11px] text-muted mt-1">in − out</div>
        </div>
      </div>

      <!-- insights -->
      <div v-if="insights.length" class="flex flex-wrap gap-2 mb-5">
        <span
          v-for="(ins, i) in insights"
          :key="i"
          class="border px-2.5 py-1 text-[11px]"
          :class="{
            'border-accent text-accent': ins.tone === 'up' || ins.tone === 'warn',
            'border-good text-good': ins.tone === 'down',
          }"
        >
          <template v-if="ins.tone === 'warn'">▲ </template>
          <template v-else-if="ins.tone === 'up'">↑ </template>
          <template v-else>↓ </template>
          {{ ins.text }}
        </span>
      </div>

      <!-- 12-month trend -->
      <div class="card p-4 mb-5">
        <div class="flex items-center justify-between gap-2 mb-3 h-4">
          <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted truncate">Monthly spend, last 12 months</h2>
          <div class="text-[11px] text-muted tnum whitespace-nowrap shrink-0">
            <template v-if="hover">{{ monthLabel(hover.key) }} · {{ formatCents(hover.cents) }}</template>
          </div>
        </div>
        <div class="relative h-40" @mouseleave="hover = null">
          <!-- gridlines -->
          <div
            v-for="f in [0, 0.5, 1]"
            :key="f"
            class="absolute inset-x-0 border-t border-line"
            :style="{ bottom: `${16 + f * (160 - 16 - 8)}px` }"
          />
          <span class="absolute right-0 text-[9px] text-muted tnum" :style="{ bottom: `${16 + (160 - 16 - 8)}px` }">
            {{ formatCents(trendMax, true) }}</span>
          <span class="absolute right-0 bottom-[16px] text-[9px] text-muted">0</span>
          <!-- bars -->
          <div class="absolute inset-0 flex items-end justify-between gap-[2px] px-1">
            <div
              v-for="b in trend"
              :key="b.key"
              class="flex-1 flex flex-col items-center justify-end h-full cursor-default"
              @mouseenter="hover = b"
              @touchstart.passive="hover = b"
            >
              <div
                class="w-full max-w-6 rounded-t-[4px] min-h-px"
                :class="b.key === selMonth ? 'bg-accent' : 'bg-accent/60'"
                :style="{ height: `${(b.cents / trendMax) * (160 - 16 - 8)}px` }"
              />
              <div class="text-[9px] text-muted mt-1 h-3 uppercase">{{ b.label[0] }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- category breakdown -->
      <div class="card p-4 mb-5">
        <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted mb-3">
          By category · {{ monthLabel(selMonth) }}
        </h2>
        <p v-if="!byCategory.length" class="text-xs text-muted">No spending this month.</p>
        <div v-for="c in byCategory" :key="c.name" class="mb-3 last:mb-0">
          <div class="flex justify-between text-xs mb-1">
            <span>{{ c.name }}</span>
            <span class="tnum text-muted">
              {{ formatCents(c.cents) }}<template v-if="c.budget">
                / {{ formatCents(c.budget, true) }}
                <span :class="c.cents > c.budget ? 'text-accent' : ''">
                  ({{ Math.round((c.cents / c.budget) * 100) }}%)</span></template>
            </span>
          </div>
          <!-- meter: budget-relative when a budget exists, else month-max relative -->
          <div class="h-2 bg-accent-soft relative overflow-hidden">
            <div
              class="h-full"
              :class="c.budget && c.cents > c.budget ? 'bg-accent' : 'bg-accent/80'"
              :style="{
                width: `${Math.min(100, (c.cents / (c.budget || catMax)) * 100)}%`,
              }"
            />
            <div
              v-if="c.budget && c.cents > c.budget"
              class="absolute inset-y-0 right-0 w-0.5 bg-paper"
            />
          </div>
        </div>
      </div>

      <!-- recurring / subscriptions -->
      <div v-if="recurring.length" class="card p-4 mb-5">
        <div class="flex items-baseline justify-between mb-2">
          <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted">
            Recurring &amp; subscriptions
          </h2>
          <span class="text-[11px] text-muted tnum">
            {{ formatCents(recurringMonthly) }}/mo · {{ recurring.length }} items
          </span>
        </div>
        <div
          v-for="r in recurring"
          :key="r.merchant"
          class="flex items-center gap-3 py-1.5 border-t border-line/60 text-xs"
        >
          <span class="flex-1 min-w-0 truncate">
            {{ r.merchant }}
            <span class="text-[10px] text-muted uppercase tracking-[0.08em]">{{ r.category }}</span>
          </span>
          <span class="text-[10px] text-muted shrink-0">next ~{{ r.next.slice(5) }}</span>
          <span class="tnum shrink-0">{{ formatCents(r.amountCents) }}</span>
        </div>
      </div>

      <!-- money out -->
      <div class="flex items-center gap-2 mb-2 mt-1">
        <span class="text-[10px] uppercase tracking-[0.18em] text-accent">Money out</span>
        <span class="h-px flex-1 bg-line" />
        <span class="text-[11px] text-muted tnum">{{ formatCents(spentThis) }}</span>
      </div>
      <div class="grid md:grid-cols-2 gap-5 mb-5">
        <!-- top merchants -->
        <div class="card p-4">
          <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted mb-2">Top merchants</h2>
          <p v-if="!topMerchants.length" class="text-xs text-muted">—</p>
          <div
            v-for="m in topMerchants"
            :key="m.name"
            class="flex justify-between py-1.5 border-t border-line/60 text-xs"
          >
            <span class="truncate min-w-0">{{ m.name }} <span class="text-muted">×{{ m.n }}</span></span>
            <span class="tnum shrink-0">{{ formatCents(m.cents) }}</span>
          </div>
        </div>
        <!-- largest spend -->
        <div class="card p-4">
          <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted mb-2">Largest this month</h2>
          <p v-if="!largest.length" class="text-xs text-muted">—</p>
          <div
            v-for="t in largest"
            :key="t.id"
            class="flex justify-between py-1.5 border-t border-line/60 text-xs"
          >
            <span class="truncate min-w-0">{{ t.merchant }} <span class="text-muted">{{ t.date.slice(5) }}</span></span>
            <span class="tnum shrink-0">{{ formatCents(t.amountCents) }}</span>
          </div>
        </div>
      </div>

      <!-- money in -->
      <div class="flex items-center gap-2 mb-2">
        <span class="text-[10px] uppercase tracking-[0.18em] text-good">Money in</span>
        <span class="h-px flex-1 bg-line" />
        <span class="text-[11px] text-muted tnum">{{ formatCents(earnedThis) }}</span>
      </div>
      <div v-if="!topIncomeSources.length" class="card p-4 text-xs text-muted">
        No income recorded for {{ monthLabel(selMonth) }}.
      </div>
      <div v-else class="grid md:grid-cols-2 gap-5">
        <!-- top income sources -->
        <div class="card p-4">
          <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted mb-2">Top income sources</h2>
          <div
            v-for="m in topIncomeSources"
            :key="m.name"
            class="flex justify-between py-1.5 border-t border-line/60 text-xs"
          >
            <span class="truncate min-w-0">{{ m.name }} <span class="text-muted">×{{ m.n }}</span></span>
            <span class="tnum shrink-0 text-good">{{ formatCents(m.cents) }}</span>
          </div>
        </div>
        <!-- largest income -->
        <div class="card p-4">
          <h2 class="text-[10px] uppercase tracking-[0.14em] text-muted mb-2">Largest income this month</h2>
          <div
            v-for="t in largestIncome"
            :key="t.id"
            class="flex justify-between py-1.5 border-t border-line/60 text-xs"
          >
            <span class="truncate min-w-0">{{ t.merchant }} <span class="text-muted">{{ t.date.slice(5) }}</span></span>
            <span class="tnum shrink-0 text-good">{{ formatCents(t.amountCents) }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
