import { reactive } from 'vue'
import type { Txn } from './types'

/** tiny global UI store: the add/edit sheet lives in App.vue */
export const ui = reactive<{
  sheetOpen: boolean
  editing: Txn | null
}>({
  sheetOpen: false,
  editing: null,
})

export function openNewTxn() {
  ui.editing = null
  ui.sheetOpen = true
}

export function openEditTxn(txn: Txn) {
  ui.editing = txn
  ui.sheetOpen = true
}

export function closeSheet() {
  ui.sheetOpen = false
  ui.editing = null
}
