const fmt = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })
const fmtWhole = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
})

export function formatCents(cents: number, whole = false): string {
  return (whole ? fmtWhole : fmt).format(cents / 100)
}

/** "12.50", "$1,234.56", "1234" → cents; NaN-safe */
export function parseToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "2026-07" for a Date or ISO date string */
export function monthKey(date: string | Date): string {
  const s = typeof date === 'string' ? date : todayISOFrom(date)
  return s.slice(0, 7)
}

function todayISOFrom(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' })
}

/** last n month keys ending at the given month (inclusive), oldest first */
export function lastMonthKeys(n: number, end = new Date()): string[] {
  const keys: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}
