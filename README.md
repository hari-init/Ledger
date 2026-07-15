# Ledger

A personal expense tracker that pulls transaction-alert emails from your Gmail account(s),
parses them into expenses with Gemini, and gives you a dashboard — all in the browser, all on
your device.

**Runs entirely free.** No server, no database, no subscriptions.

## What it does

- **Email sync** — connect one or more Gmail accounts (read-only) and it finds bank / credit-card
  alert emails, then Gemini extracts each into a structured expense.
- **Statement upload** — drop in a PDF statement, a CSV export, or a screenshot; Gemini reads every
  transaction. Needs only a Gemini key, no Gmail.
- **Manual entry** — full add / edit / delete, search, and filters.
- **Review queue** — everything imported waits for a one-tap confirm before it counts.
- **Dashboard** — month total with vs-last-month delta, 12-month spend chart, category breakdown
  with budgets, top merchants and income sources (money-in / money-out), recurring-subscription
  detection, and month-over-month insight callouts.
- **Ask your money** — ask questions in plain English ("how much on dining in June?"); Gemini
  answers from your on-device data.
- **Smart auto-categorization** — correct a merchant's category once and every future import
  remembers it.
- Tuned for Canadian banks (RBC / TD / Scotiabank / BMO / CIBC / Tangerine / Interac), CAD.

## How it stays free & private

| Concern | Solution |
|---|---|
| Hosting | Static site (Cloudflare Pages, or run locally) |
| Gmail access | In-browser Google Identity Services token flow, `gmail.readonly`, your own OAuth client |
| AI parsing | Gemini free tier, your own API key, called from the browser |
| Storage | IndexedDB (Dexie) on your device; JSON export/import for backup |
| Install | Installable PWA, works offline |

Your Gemini key and OAuth client ID are stored only in your browser's `localStorage` — they are
never committed to this repo or sent anywhere except Google's own APIs.

## Stack

Vue 3 (`<script setup>`) · Vite · TypeScript · Tailwind CSS v4 · Dexie (IndexedDB) · vite-plugin-pwa.

## Run locally

```sh
npm install
npm run dev
```

Try it right away with **Settings → Seed demo data**, or **Sync → Test harness** to push sample
bank emails through the real import pipeline (no keys needed).

## One-time setup for real email sync (all free)

The in-app **Settings** page walks you through this with links:

1. **Google OAuth Client ID** — create a Google Cloud project, enable the Gmail API, set the OAuth
   consent screen to *Testing* mode (add every Gmail you'll sync as a test user), and create a
   *Web application* OAuth client with your app origin under Authorized JavaScript origins.
2. **Gemini API key** — from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   (free tier, no card).
3. Turn on transaction-alert emails in each bank's app.

## Build & deploy

```sh
npm run build   # → dist/
```

Deploy `dist/` to Cloudflare Pages (an SPA `_redirects` file is included). Then add the deployed
origin to your OAuth client's Authorized JavaScript origins.

## Notes

- Data is per-device (no cross-device sync yet) — export JSON regularly to back up.
- First sync of an account looks back 30 days (configurable); later syncs fetch only new mail.
- Dedup: exact by Gmail message id, plus fuzzy by amount + date + merchant (catches the same
  transaction alerted in two inboxes).
- Access tokens last ~1 hour, so a later sync may pop a quick Google account chooser — normal for
  a personal app in Testing mode.

---

Built with [Claude Code](https://claude.com/claude-code).
