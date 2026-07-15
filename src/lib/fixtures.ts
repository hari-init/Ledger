import type { EmailMessage, ParsedEmail } from './types'

/**
 * Realistic Canadian bank-alert fixtures for the dev test harness.
 * `expected` is what a correct parser should extract — used as the mock
 * parser when no Gemini key is configured, and as a reference otherwise.
 */
interface Fixture {
  email: EmailMessage
  expected: ParsedEmail
}

const iso = (d: string) => `${d}T14:03:00.000Z`

export const FIXTURES: Fixture[] = [
  {
    email: {
      id: 'fx-rbc-1',
      from: 'RBC Royal Bank <alerts@rbc.com>',
      subject: 'Purchase alert: $43.17 at TIM HORTONS #4021',
      date: iso('2026-07-08'),
      body: 'A purchase of $43.17 CAD was made at TIM HORTONS #4021 TORONTO ON using your RBC Visa card ending in 4021 on July 8, 2026. If you do not recognize this transaction, contact us immediately.',
    },
    expected: {
      emailId: 'fx-rbc-1',
      isTransaction: true,
      amount: 43.17,
      currency: 'CAD',
      merchant: 'Tim Hortons',
      date: '2026-07-08',
      direction: 'debit',
      accountHint: 'RBC Visa ****4021',
      category: 'Dining',
      confidence: 0.97,
    },
  },
  {
    email: {
      id: 'fx-td-1',
      from: 'TD Canada Trust <TDAlerts@td.com>',
      subject: 'TD Alert: A debit card purchase was approved',
      date: iso('2026-07-09'),
      body: 'A debit card purchase of $128.44 was approved on your account ending 5512 at LOBLAWS 1048 on Jul 9, 2026 at 6:12 PM ET. Available balance: $2,318.20.',
    },
    expected: {
      emailId: 'fx-td-1',
      isTransaction: true,
      amount: 128.44,
      currency: 'CAD',
      merchant: 'Loblaws',
      date: '2026-07-09',
      direction: 'debit',
      accountHint: 'TD debit ****5512',
      category: 'Groceries',
      confidence: 0.96,
    },
  },
  {
    email: {
      id: 'fx-interac-1',
      from: 'Interac e-Transfer <notify@payments.interac.ca>',
      subject: 'INTERAC e-Transfer: You sent money to Priya S.',
      date: iso('2026-07-10'),
      body: 'Hi HARI, you sent $250.00 (CAD) to PRIYA S and the money has been automatically deposited. Reference number: CAvXk29dd1.',
    },
    expected: {
      emailId: 'fx-interac-1',
      isTransaction: true,
      amount: 250,
      currency: 'CAD',
      merchant: 'Priya S',
      date: '2026-07-10',
      direction: 'debit',
      accountHint: '',
      category: 'Money Sent',
      confidence: 0.95,
    },
  },
  {
    email: {
      id: 'fx-interac-2',
      from: 'Interac e-Transfer <notify@payments.interac.ca>',
      subject: 'INTERAC e-Transfer: Arjun M. sent you money',
      date: iso('2026-07-11'),
      body: 'Hi HARI, ARJUN M sent you $75.00 (CAD) and the money has been automatically deposited into your account. Message: rent split.',
    },
    expected: {
      emailId: 'fx-interac-2',
      isTransaction: true,
      amount: 75,
      currency: 'CAD',
      merchant: 'Arjun M',
      date: '2026-07-11',
      direction: 'credit',
      accountHint: '',
      category: 'Transfers',
      confidence: 0.95,
    },
  },
  {
    email: {
      id: 'fx-scotia-1',
      from: 'Scotiabank <infoalerts@scotiabank.com>',
      subject: 'Scotia InfoAlert: A pre-authorized payment was processed',
      date: iso('2026-07-05'),
      body: 'A pre-authorized payment of $16.99 to NETFLIX.COM was processed from your Scotiabank Visa ending 8830 on July 5, 2026.',
    },
    expected: {
      emailId: 'fx-scotia-1',
      isTransaction: true,
      amount: 16.99,
      currency: 'CAD',
      merchant: 'Netflix',
      date: '2026-07-05',
      direction: 'debit',
      accountHint: 'Scotiabank Visa ****8830',
      category: 'Subscriptions',
      confidence: 0.97,
    },
  },
  {
    email: {
      id: 'fx-bmo-1',
      from: 'BMO Alerts <bmoalerts@bmo.com>',
      subject: 'BMO Alert: Card purchase $62.30',
      date: iso('2026-07-06'),
      body: 'A purchase of $62.30 was made with your BMO Mastercard ending 2214 at PETRO-CANADA 7712 MISSISSAUGA ON on July 6, 2026.',
    },
    expected: {
      emailId: 'fx-bmo-1',
      isTransaction: true,
      amount: 62.3,
      currency: 'CAD',
      merchant: 'Petro-Canada',
      date: '2026-07-06',
      direction: 'debit',
      accountHint: 'BMO Mastercard ****2214',
      category: 'Transit',
      confidence: 0.9,
    },
  },
  {
    email: {
      id: 'fx-cibc-1',
      from: 'CIBC <mailbox.noreply@cibc.com>',
      subject: 'Your payroll deposit has arrived',
      date: iso('2026-07-03'),
      body: 'A direct deposit of $2,940.12 from ACME SOFTWARE INC PAYROLL was credited to your CIBC chequing account ending 0917 on July 3, 2026.',
    },
    expected: {
      emailId: 'fx-cibc-1',
      isTransaction: true,
      amount: 2940.12,
      currency: 'CAD',
      merchant: 'Acme Software Inc',
      date: '2026-07-03',
      direction: 'credit',
      accountHint: 'CIBC chequing ****0917',
      category: 'Income',
      confidence: 0.96,
    },
  },
  {
    email: {
      id: 'fx-refund-1',
      from: 'RBC Royal Bank <alerts@rbc.com>',
      subject: 'Refund posted: $29.99 from AMAZON.CA',
      date: iso('2026-07-07'),
      body: 'A refund of $29.99 CAD from AMAZON.CA was posted to your RBC Visa card ending 4021 on July 7, 2026.',
    },
    expected: {
      emailId: 'fx-refund-1',
      isTransaction: true,
      amount: 29.99,
      currency: 'CAD',
      merchant: 'Amazon.ca',
      date: '2026-07-07',
      direction: 'credit',
      accountHint: 'RBC Visa ****4021',
      category: 'Shopping',
      confidence: 0.93,
    },
  },
  {
    email: {
      id: 'fx-promo-1',
      from: 'RBC Royal Bank <email@email.rbc.com>',
      subject: 'You’re pre-approved: earn 20,000 Avion points',
      date: iso('2026-07-04'),
      body: 'Hari, upgrade to the RBC Avion Visa Infinite and earn 20,000 welcome points. Limited time offer, conditions apply.',
    },
    expected: { emailId: 'fx-promo-1', isTransaction: false },
  },
  {
    email: {
      id: 'fx-stmt-1',
      from: 'TD Canada Trust <TDAlerts@td.com>',
      subject: 'Your eStatement is ready',
      date: iso('2026-07-02'),
      body: 'Your TD credit card eStatement for the period ending June 28, 2026 is now available in EasyWeb. Minimum payment due July 21.',
    },
    expected: { emailId: 'fx-stmt-1', isTransaction: false },
  },
]

export const FIXTURE_EMAILS: EmailMessage[] = FIXTURES.map((f) => f.email)

/** Offline stand-in for Gemini: returns the known-correct parse per fixture. */
export async function mockParseEmails(emails: EmailMessage[]): Promise<ParsedEmail[]> {
  const map = new Map(FIXTURES.map((f) => [f.email.id, f.expected]))
  return emails.map(
    (e) => map.get(e.id) ?? { emailId: e.id, isTransaction: false },
  )
}
