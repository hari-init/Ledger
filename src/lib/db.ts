import Dexie, { type Table } from 'dexie'
import type { Txn, GmailAccount, Category, MerchantRule } from './types'

export class LedgerDB extends Dexie {
  transactions!: Table<Txn, string>
  accounts!: Table<GmailAccount, string>
  categories!: Table<Category, string>
  rules!: Table<MerchantRule, string>

  constructor() {
    super('ledger')
    this.version(1).stores({
      transactions: 'id, date, category, merchant, status, gmailMessageId',
      accounts: 'email',
      categories: 'name, order',
    })
    // v2: learned merchant → category rules for auto-categorization
    this.version(2).stores({
      transactions: 'id, date, category, merchant, status, gmailMessageId',
      accounts: 'email',
      categories: 'name, order',
      rules: 'merchant',
    })
  }
}

export const db = new LedgerDB()

/** normalized key for matching a merchant across spellings */
export function merchantKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** remember that this merchant should map to this category */
export async function rememberRule(merchant: string, category: string) {
  const key = merchantKey(merchant)
  if (!key || category === 'Other') return
  await db.rules.put({ merchant: key, category, updatedAt: Date.now() })
}

/** map of normalized merchant → category, for applying rules during import */
export async function loadRuleMap(): Promise<Map<string, string>> {
  const rules = await db.rules.toArray()
  return new Map(rules.map((r) => [r.merchant, r.category]))
}

export const DEFAULT_CATEGORIES = [
  'Groceries',
  'Dining',
  'Transit',
  'Rent',
  'Utilities',
  'Subscriptions',
  'Shopping',
  'Health',
  'Travel',
  'Income',
  'Money Sent',
  'Transfers',
  'Other',
]

export async function ensureSeedCategories() {
  const count = await db.categories.count()
  if (count === 0) {
    await db.categories.bulkAdd(
      DEFAULT_CATEGORIES.map((name, i) => ({ name, budgetCents: 0, order: i })),
    )
    return
  }
  // one-time migration for existing installs: introduce "Money Sent"
  // (guarded so it won't reappear if the user later deletes it)
  const MIG_KEY = 'ledger.migrations'
  const done: string[] = JSON.parse(localStorage.getItem(MIG_KEY) || '[]')
  if (!done.includes('money-sent')) {
    if (!(await db.categories.get('Money Sent'))) {
      const last = await db.categories.orderBy('order').last()
      await db.categories.add({ name: 'Money Sent', budgetCents: 0, order: (last?.order ?? 0) + 1 })
    }
    localStorage.setItem(MIG_KEY, JSON.stringify([...done, 'money-sent']))
  }
}

export function newId() {
  return crypto.randomUUID()
}
