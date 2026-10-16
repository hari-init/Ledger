<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { db } from './lib/db'
import { useLiveQuery } from './lib/useLiveQuery'
import { openNewTxn } from './lib/ui'
import TransactionSheet from './components/TransactionSheet.vue'

const route = useRoute()
const router = useRouter()
const reviewCount = useLiveQuery(
  () => db.transactions.where('status').equals('review').count(),
  0,
)

const tabs = [
  { to: '/', name: 'dashboard', label: 'Dashboard' },
  { to: '/transactions', name: 'transactions', label: 'Transactions' },
  { to: '/ask', name: 'ask', label: 'Ask' },
  { to: '/sync', name: 'sync', label: 'Sync' },
  { to: '/settings', name: 'settings', label: 'Settings' },
]

function navigateTab(to: string) {
  if (route.path !== to) {
    router.push(to).catch(() => {})
  }
}
</script>

<template>
  <div class="min-h-dvh md:flex">
    <!-- desktop sidebar -->
    <aside
      class="hidden md:flex md:flex-col md:w-52 md:shrink-0 border-r border-line px-5 py-6 sticky top-0 h-dvh"
    >
      <div class="mb-8">
        <div class="text-lg font-bold tracking-[0.2em]">LEDGER</div>
        <div class="text-[10px] uppercase tracking-[0.14em] text-muted mt-1">
          expenses · on-device
        </div>
      </div>
      <nav class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em]">
        <RouterLink
          v-for="t in tabs"
          :key="t.name"
          :to="t.to"
          class="px-2 py-2 border-l-2 border-transparent text-muted hover:text-ink"
          :class="route.name === t.name && 'border-accent! text-ink'"
        >
          {{ t.label }}
          <span
            v-if="t.name === 'sync' && reviewCount"
            class="ml-1 text-accent"
          >({{ reviewCount }})</span>
        </RouterLink>
      </nav>
      <button class="btn btn-accent mt-8" @click="openNewTxn">+ Add expense</button>
      <div class="mt-auto text-[10px] text-muted leading-relaxed">
        No servers. Your data never<br />leaves this device.
      </div>
    </aside>

    <!-- mobile header -->
    <header
      class="md:hidden sticky top-0 z-20 flex items-center justify-between border-b border-line bg-paper px-4 py-3"
      style="padding-top: max(0.75rem, env(safe-area-inset-top))"
    >
      <div class="text-base font-bold tracking-[0.2em]">LEDGER</div>
      <button class="btn btn-accent py-1.5!" @click="openNewTxn">+ Add</button>
    </header>

    <!-- main -->
    <main class="flex-1 min-w-0 px-4 py-5 md:px-8 md:py-8 pb-24 md:pb-8">
      <RouterView />
    </main>

    <!-- mobile bottom nav -->
    <nav
      class="md:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-5 border-t border-line bg-paper select-none"
      style="padding-bottom: max(0.25rem, env(safe-area-inset-bottom))"
    >
      <button
        v-for="t in tabs"
        :key="t.name"
        type="button"
        class="relative flex flex-col items-center justify-center py-3 text-center text-[10px] uppercase tracking-[0.12em] text-muted cursor-pointer transition-colors active:opacity-60 touch-manipulation focus:outline-none"
        :class="route.name === t.name ? 'text-ink font-semibold' : 'hover:text-ink'"
        @click="navigateTab(t.to)"
      >
        <span
          v-if="route.name === t.name"
          class="absolute top-0 left-1/4 right-1/4 h-0.5 bg-accent"
        />
        <span>{{ t.label === 'Transactions' ? 'Txns' : t.label }}</span>
        <span v-if="t.name === 'sync' && reviewCount" class="text-accent text-[9px]">
          ({{ reviewCount }})
        </span>
      </button>
    </nav>

    <TransactionSheet />
  </div>
</template>
