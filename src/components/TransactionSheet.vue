<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { db, newId, rememberRule } from '../lib/db'
import { useLiveQuery } from '../lib/useLiveQuery'
import { parseToCents, todayISO } from '../lib/money'
import { ui, closeSheet } from '../lib/ui'
import AppSelect from './AppSelect.vue'
import type { Direction } from '../lib/types'

const categories = useLiveQuery(() => db.categories.orderBy('order').toArray(), [])
const categoryOptions = computed(() => categories.value.map((c) => ({ value: c.name, label: c.name })))

const form = reactive({
  amount: '',
  direction: 'debit' as Direction,
  merchant: '',
  category: 'Other',
  date: todayISO(),
  account: '',
  notes: '',
})
const error = ref('')
// only dismiss when the press STARTED on the backdrop — a click that merely
// ends there (or a stray synthetic click) must not close the sheet
const downOnBackdrop = ref(false)
function backdropClick() {
  if (downOnBackdrop.value) closeSheet()
  downOnBackdrop.value = false
}

watch(
  () => ui.sheetOpen,
  (open) => {
    if (!open) return
    error.value = ''
    const t = ui.editing
    form.amount = t ? (t.amountCents / 100).toFixed(2) : ''
    form.direction = t?.direction ?? 'debit'
    form.merchant = t?.merchant ?? ''
    form.category = t?.category ?? 'Other'
    form.date = t?.date ?? todayISO()
    form.account = t?.account ?? ''
    form.notes = t?.notes ?? ''
  },
)

async function save() {
  const cents = parseToCents(form.amount)
  if (!cents || cents <= 0) return (error.value = 'Enter a valid amount')
  if (!form.merchant.trim()) return (error.value = 'Enter a merchant / payee')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return (error.value = 'Enter a valid date')
  const now = Date.now()
  if (ui.editing) {
    await db.transactions.update(ui.editing.id, {
      amountCents: cents,
      direction: form.direction,
      merchant: form.merchant.trim(),
      category: form.category,
      date: form.date,
      account: form.account.trim(),
      notes: form.notes.trim() || undefined,
      status: 'confirmed',
      updatedAt: now,
    })
  } else {
    await db.transactions.add({
      id: newId(),
      amountCents: cents,
      currency: 'CAD',
      direction: form.direction,
      merchant: form.merchant.trim(),
      category: form.category,
      date: form.date,
      account: form.account.trim(),
      source: 'manual',
      status: 'confirmed',
      notes: form.notes.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    })
  }
  // learn this merchant → category so future imports auto-apply it
  await rememberRule(form.merchant.trim(), form.category)
  closeSheet()
}

async function remove() {
  if (!ui.editing) return
  if (!confirm(`Delete "${ui.editing.merchant}" (${form.amount})?`)) return
  await db.transactions.delete(ui.editing.id)
  closeSheet()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="ui.sheetOpen"
      class="fixed inset-0 z-40 bg-ink/40 flex items-end md:items-center md:justify-center"
      @pointerdown.self="downOnBackdrop = true"
      @click.self="backdropClick"
    >
      <div
        class="w-full md:max-w-md bg-paper border-t md:border border-line p-5 max-h-[92dvh] overflow-y-auto"
        style="padding-bottom: max(1.25rem, env(safe-area-inset-bottom))"
      >
        <div class="flex items-center justify-between mb-5">
          <div class="text-xs uppercase tracking-[0.2em]">
            {{ ui.editing ? 'Edit entry' : 'New entry' }}
          </div>
          <button class="text-muted hover:text-ink text-lg leading-none" @click="closeSheet">
            ×
          </button>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Type</label>
            <div class="grid grid-cols-2 border border-line text-center text-xs uppercase">
              <button
                class="py-2.5 tracking-[0.1em] cursor-pointer"
                :class="form.direction === 'debit' ? 'bg-accent text-paper' : 'text-muted'"
                @click="form.direction = 'debit'"
              >
                Spend
              </button>
              <button
                class="py-2.5 tracking-[0.1em] cursor-pointer"
                :class="form.direction === 'credit' ? 'bg-good text-paper' : 'text-muted'"
                @click="form.direction = 'credit'"
              >
                In
              </button>
            </div>
          </div>
          <div>
            <label class="label">Amount (CAD)</label>
            <input
              v-model="form.amount"
              inputmode="decimal"
              placeholder="0.00"
              class="tnum"
              @keydown.enter="save"
            />
          </div>
          <div class="col-span-2">
            <label class="label">Merchant / payee</label>
            <input v-model="form.merchant" placeholder="Tim Hortons" @keydown.enter="save" />
          </div>
          <div>
            <label class="label">Category</label>
            <AppSelect v-model="form.category" :options="categoryOptions" />
          </div>
          <div>
            <label class="label">Date</label>
            <input v-model="form.date" type="date" />
          </div>
          <div class="col-span-2">
            <label class="label">Account</label>
            <input v-model="form.account" placeholder="RBC Visa ****4021" />
          </div>
          <div class="col-span-2">
            <label class="label">Notes</label>
            <input v-model="form.notes" placeholder="optional" @keydown.enter="save" />
          </div>
        </div>

        <p v-if="error" class="text-accent text-xs mt-3">{{ error }}</p>

        <div class="flex gap-2 mt-5">
          <button class="btn btn-accent flex-1" @click="save">Save</button>
          <button v-if="ui.editing" class="btn" @click="remove">Delete</button>
          <button class="btn" @click="closeSheet">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
