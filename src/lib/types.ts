export type Direction = 'debit' | 'credit'
export type TxnSource = 'manual' | 'email' | 'import'
export type TxnStatus = 'confirmed' | 'review'

/** one transaction extracted from an uploaded statement / CSV / receipt */
export interface DocTxn {
  amount?: number
  currency?: string
  merchant?: string
  /** YYYY-MM-DD */
  date?: string
  direction?: Direction
  account?: string
  category?: string
  confidence?: number
}

export interface Txn {
  id: string
  amountCents: number
  currency: string
  direction: Direction
  merchant: string
  category: string
  /** ISO date, YYYY-MM-DD */
  date: string
  /** payment account label, e.g. "TD Visa" */
  account: string
  source: TxnSource
  /** gmail address the email came from, when source === 'email' */
  sourceEmail?: string
  gmailMessageId?: string
  status: TxnStatus
  /** 0..1, set by the parser for email-sourced txns */
  confidence?: number
  notes?: string
  createdAt: number
  updatedAt: number
}

export interface GmailAccount {
  email: string
  connectedAt: number
  lastSyncAt: number | null
}

export interface Category {
  name: string
  /** monthly budget; 0 = no budget */
  budgetCents: number
  order: number
}

/** learned rule: a normalized merchant name always maps to this category */
export interface MerchantRule {
  merchant: string
  category: string
  updatedAt: number
}

export interface Settings {
  oauthClientId: string
  geminiApiKey: string
  geminiModel: string
  /** sender addresses/domains used to find transaction emails */
  senderFilters: string[]
  /** how far back the first sync of an account looks */
  lookbackDays: number

  // --- end-to-end-encrypted cross-device sync (all optional) ---
  /** deployed Cloudflare Worker base URL */
  syncUrl: string
  /** unguessable id that names your encrypted blob + acts as the access secret */
  syncId: string
  /** passphrase the blob is encrypted with — never leaves this device except as ciphertext */
  syncPassphrase: string
  /** auto pull-on-open and push-on-change */
  syncAuto: boolean
  /** version (ms timestamp) of the last blob this device pushed or pulled */
  lastSyncedVersion: number
  /** wall-clock time of the last successful sync */
  lastSyncedAt: number
  /** stable per-device label, shown so you can tell which device last wrote */
  deviceId: string
}

export interface EmailMessage {
  id: string
  from: string
  subject: string
  /** ISO date of the email */
  date: string
  body: string
}

export interface ParsedEmail {
  emailId: string
  isTransaction: boolean
  /** amount in dollars, e.g. 12.5 */
  amount?: number
  currency?: string
  merchant?: string
  /** YYYY-MM-DD */
  date?: string
  direction?: Direction
  accountHint?: string
  category?: string
  confidence?: number
}

export interface SyncReport {
  account: string
  found: number
  alreadyImported: number
  notTransactions: number
  duplicates: number
  imported: number
  errors: string[]
}
