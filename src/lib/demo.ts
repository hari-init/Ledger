import { db, newId } from './db'
import type { Txn, Direction } from './types'

// deterministic RNG so demo data is stable run-to-run
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MERCHANTS: Record<string, [string, number, number][]> = {
  // category -> [merchant, minCents, maxCents]
  Groceries: [
    ['Loblaws', 3500, 16000],
    ['No Frills', 2200, 9000],
    ['Costco', 9000, 28000],
    ['T&T Supermarket', 3000, 12000],
  ],
  Dining: [
    ['Tim Hortons', 350, 1800],
    ['Chipotle', 1300, 2600],
    ['A&W', 900, 2200],
    ['Sushi on Bloor', 2400, 6500],
  ],
  Transit: [
    ['Presto', 330, 4000],
    ['Uber', 900, 3200],
    ['Petro-Canada', 4500, 8500],
  ],
  Utilities: [
    ['Toronto Hydro', 5500, 11000],
    ['Bell Canada', 6500, 6500],
    ['Freedom Mobile', 4500, 4500],
  ],
  Subscriptions: [
    ['Netflix', 1699, 1699],
    ['Spotify', 1199, 1199],
    ['iCloud', 399, 399],
    ['YouTube Premium', 1399, 1399],
  ],
  Shopping: [
    ['Amazon.ca', 1500, 12000],
    ['Uniqlo', 3000, 9000],
    ['Canadian Tire', 2000, 15000],
  ],
  Health: [
    ['Shoppers Drug Mart', 800, 6000],
    ['GoodLife Fitness', 3499, 3499],
  ],
  Travel: [['Air Canada', 18000, 45000], ['VIA Rail', 4900, 12000]],
}

export async function seedDemoData(): Promise<number> {
  const rand = mulberry32(20260712)
  const now = new Date()
  const txns: Txn[] = []
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]

  for (let m = 0; m < 6; m++) {
    const base = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
    const lastDay = m === 0 ? now.getDate() : daysInMonth

    const add = (
      category: string,
      merchant: string,
      amountCents: number,
      day: number,
      direction: Direction = 'debit',
      account = 'RBC Visa ****4021',
    ) => {
      if (day > lastDay) return
      const date = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const t = Date.now()
      txns.push({
        id: `demo-${newId()}`,
        amountCents,
        currency: 'CAD',
        direction,
        merchant,
        category,
        date,
        account,
        source: 'manual',
        status: 'confirmed',
        notes: 'demo',
        createdAt: t,
        updatedAt: t,
      })
    }

    // fixed monthly items
    add('Rent', 'Parkview Apartments', 195000, 1, 'debit', 'CIBC chequing ****0917')
    add('Income', 'Acme Software Inc', 294012, 3, 'credit', 'CIBC chequing ****0917')
    add('Income', 'Acme Software Inc', 294012, 17, 'credit', 'CIBC chequing ****0917')
    for (const [merchant, lo] of MERCHANTS.Subscriptions) {
      add('Subscriptions', merchant, lo, 5 + Math.floor(rand() * 10))
    }
    add('Utilities', 'Toronto Hydro', 5500 + Math.floor(rand() * 5500), 12)
    add('Utilities', 'Freedom Mobile', 4500, 20)

    // variable spending
    const counts: Record<string, number> = {
      Groceries: 6,
      Dining: 9,
      Transit: 7,
      Shopping: 3,
      Health: 2,
    }
    for (const [category, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) {
        const [merchant, lo, hi] = pick(MERCHANTS[category])
        add(
          category,
          merchant,
          lo + Math.floor(rand() * (hi - lo + 1)),
          1 + Math.floor(rand() * daysInMonth),
          'debit',
          rand() > 0.5 ? 'RBC Visa ****4021' : 'TD debit ****5512',
        )
      }
    }
    // occasional travel
    if (m === 2 || m === 5) {
      const [merchant, lo, hi] = pick(MERCHANTS.Travel)
      add('Travel', merchant, lo + Math.floor(rand() * (hi - lo + 1)), 15)
    }
  }

  await db.transactions.bulkAdd(txns)
  return txns.length
}

export async function removeDemoData(): Promise<number> {
  const demoIds = (await db.transactions.toArray())
    .filter((t) => t.id.startsWith('demo-'))
    .map((t) => t.id)
  await db.transactions.bulkDelete(demoIds)
  return demoIds.length
}
