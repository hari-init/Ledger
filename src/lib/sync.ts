import { db, newId, merchantKey, loadRuleMap } from './db'
import { settings } from './settings'
import { requestToken, buildQuery, listMessageIds, getMessage } from './gmail'
import { parseEmails, getAiDisplayName } from './ai'
import type { DocTxn, EmailMessage, ParsedEmail, SyncReport, Txn } from './types'

export type ParseFn = (emails: EmailMessage[], categories: string[]) => Promise<ParsedEmail[]>

const OVERLAP_MS = 2 * 24 * 3600 * 1000 // re-scan 2 days back to survive clock skew

/** Connect a new Gmail account (interactive account picker). */
export async function connectAccount(): Promise<string> {
  const { email } = await requestToken(settings.oauthClientId)
  const existing = await db.accounts.get(email)
  if (!existing) {
    await db.accounts.add({ email, connectedAt: Date.now(), lastSyncAt: null })
  }
  return email
}

/** Sync one connected account: fetch new alert emails, parse, queue for review. */
export async function syncAccount(
  email: string,
  log: (line: string) => void,
  parse?: ParseFn,
): Promise<SyncReport> {
  const report: SyncReport = {
    account: email,
    found: 0,
    alreadyImported: 0,
    notTransactions: 0,
    duplicates: 0,
    imported: 0,
    errors: [],
  }
  const account = await db.accounts.get(email)
  if (!account) throw new Error(`${email} is not connected`)

  log(`${email}: authorizing…`)
  const { token } = await requestToken(settings.oauthClientId, email)

  const since = account.lastSyncAt
    ? account.lastSyncAt - OVERLAP_MS
    : Date.now() - settings.lookbackDays * 24 * 3600 * 1000
  const q = buildQuery(settings.senderFilters, since / 1000)
  log(`${email}: searching "${q}"`)
  const ids = await listMessageIds(token, q)
  report.found = ids.length
  if (ids.length === 0) {
    await db.accounts.update(email, { lastSyncAt: Date.now() })
    log(`${email}: no new alert emails`)
    return report
  }

  const existing = new Set(
    (await db.transactions.where('gmailMessageId').anyOf(ids).toArray()).map(
      (t) => t.gmailMessageId,
    ),
  )
  const newIds = ids.filter((id) => !existing.has(id))
  report.alreadyImported = ids.length - newIds.length
  log(`${email}: ${ids.length} emails found, ${newIds.length} new`)
  if (newIds.length === 0) {
    await db.accounts.update(email, { lastSyncAt: Date.now() })
    return report
  }

  const emails: EmailMessage[] = []
  for (const id of newIds) {
    try {
      emails.push(await getMessage(token, id))
    } catch (e) {
      report.errors.push(`fetch ${id}: ${(e as Error).message}`)
    }
  }

  const categories = (await db.categories.orderBy('order').toArray()).map((c) => c.name)
  log(`${email}: parsing ${emails.length} emails with ${getAiDisplayName()}…`)
  const parseFn: ParseFn =
    parse ??
    ((ems, cats) =>
      parseEmails(
        ems,
        cats,
        (d, t) => log(`${email}: parsed ${d}/${t}`),
        log,
      ))
  const parsed = await parseFn(emails, categories)

  const counts = await importParsedEmails(parsed, emails, email, categories)
  report.notTransactions = counts.notTransactions
  report.duplicates = counts.duplicates
  report.imported = counts.imported

  await db.accounts.update(email, { lastSyncAt: Date.now() })
  log(
    `${email}: done — ${report.imported} queued for review, ${report.notTransactions} non-transactions, ${report.duplicates} duplicates`,
  )
  return report
}

/**
 * Shared import path (real sync AND the fixture test harness):
 * validates, fuzzy-dedupes, and inserts as status=review.
 */
export async function importParsedEmails(
  parsed: ParsedEmail[],
  emails: EmailMessage[],
  sourceEmail: string,
  categories: string[],
): Promise<{ imported: number; notTransactions: number; duplicates: number }> {
  const byId = new Map(emails.map((e) => [e.id, e]))
  let imported = 0
  let notTransactions = 0
  let duplicates = 0

  const all = await db.transactions.toArray()
  const fuzzyKeys = new Set(all.map(fuzzyKey))
  const rules = await loadRuleMap()

  const toAdd: Txn[] = []
  for (const p of parsed) {
    const src = byId.get(p.emailId)
    if (!p.isTransaction || !p.amount || p.amount <= 0) {
      notTransactions++
      continue
    }
    const now = Date.now()
    const merchant = (p.merchant || 'Unknown').trim()
    const txn: Txn = {
      id: newId(),
      amountCents: Math.round(p.amount * 100),
      currency: (p.currency || 'CAD').toUpperCase(),
      direction: p.direction === 'credit' ? 'credit' : 'debit',
      merchant,
      // a learned rule for this merchant overrides Gemini's guess
      category:
        rules.get(merchantKey(merchant)) ??
        (categories.includes(p.category ?? '') ? p.category! : 'Other'),
      date: normalizeDate(p.date, src?.date),
      account: (p.accountHint || '').trim(),
      source: 'email',
      sourceEmail,
      gmailMessageId: src?.id,
      status: 'review',
      confidence: p.confidence,
      notes: src ? src.subject.slice(0, 120) : undefined,
      createdAt: now,
      updatedAt: now,
    }
    const key = fuzzyKey(txn)
    if (fuzzyKeys.has(key)) {
      duplicates++
      continue
    }
    fuzzyKeys.add(key)
    toAdd.push(txn)
    imported++
  }
  if (toAdd.length) await db.transactions.bulkAdd(toAdd)
  return { imported, notTransactions, duplicates }
}

/**
 * Import transactions extracted from an uploaded statement / CSV / receipt.
 * Same fuzzy-dedupe + review-queue path as email import, but standalone
 * (no Gmail involved — only a Gemini key).
 */
export async function importDocumentTxns(
  parsed: DocTxn[],
  sourceLabel: string,
  categories: string[],
): Promise<{ imported: number; duplicates: number; skipped: number }> {
  let imported = 0
  let duplicates = 0
  let skipped = 0

  const all = await db.transactions.toArray()
  const fuzzyKeys = new Set(all.map(fuzzyKey))
  const rules = await loadRuleMap()

  const toAdd: Txn[] = []
  for (const p of parsed) {
    if (!p.amount || p.amount <= 0) {
      skipped++
      continue
    }
    const now = Date.now()
    const merchant = (p.merchant || 'Unknown').trim()
    const txn: Txn = {
      id: newId(),
      amountCents: Math.round(p.amount * 100),
      currency: (p.currency || 'CAD').toUpperCase(),
      direction: p.direction === 'credit' ? 'credit' : 'debit',
      merchant,
      category:
        rules.get(merchantKey(merchant)) ??
        (categories.includes(p.category ?? '') ? p.category! : 'Other'),
      date: normalizeDate(p.date, undefined),
      account: (p.account || '').trim(),
      source: 'import',
      status: 'review',
      confidence: p.confidence,
      notes: sourceLabel,
      createdAt: now,
      updatedAt: now,
    }
    const key = fuzzyKey(txn)
    if (fuzzyKeys.has(key)) {
      duplicates++
      continue
    }
    fuzzyKeys.add(key)
    toAdd.push(txn)
    imported++
  }
  if (toAdd.length) await db.transactions.bulkAdd(toAdd)
  return { imported, duplicates, skipped }
}

/** same amount + date + merchant ⇒ same transaction, even across inboxes */
function fuzzyKey(t: Txn): string {
  return `${t.amountCents}|${t.date}|${t.merchant.toLowerCase().replace(/\s+/g, ' ').trim()}`
}

function normalizeDate(d: string | undefined, emailDate: string | undefined): string {
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  if (emailDate) return emailDate.slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}
