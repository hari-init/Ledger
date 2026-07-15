import type { EmailMessage } from './types'

const SCOPES =
  'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email'

declare global {
  interface Window {
    google?: any
  }
}

let gisPromise: Promise<void> | null = null

/** Load the Google Identity Services script once. */
export function loadGis(): Promise<void> {
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve()
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => {
        gisPromise = null
        reject(new Error('Could not load Google sign-in script (offline?)'))
      }
      document.head.appendChild(s)
    })
  }
  return gisPromise
}

interface CachedToken {
  token: string
  expiresAt: number
}

// access tokens live ~1h; kept in memory only, never persisted
const tokenCache = new Map<string, CachedToken>()

/**
 * Get a Gmail access token. With `email` set, GIS is hinted at that account
 * (usually silent if the Google session is alive); without it, the user picks
 * an account — used for "connect another Gmail".
 */
export async function requestToken(
  clientId: string,
  email?: string,
): Promise<{ token: string; email: string }> {
  if (!clientId) throw new Error('No OAuth Client ID set — see Settings → Setup')
  if (email) {
    const cached = tokenCache.get(email)
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return { token: cached.token, email }
    }
  }
  await loadGis()
  const resp = await new Promise<any>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      hint: email,
      prompt: email ? '' : 'select_account',
      callback: (r: any) =>
        r.error ? reject(new Error(r.error_description || r.error)) : resolve(r),
      error_callback: (e: any) =>
        reject(new Error(e?.message || 'Google sign-in popup was closed or blocked')),
    })
    client.requestAccessToken()
  })
  const grantedEmail = await fetchUserEmail(resp.access_token)
  tokenCache.set(grantedEmail, {
    token: resp.access_token,
    expiresAt: Date.now() + Number(resp.expires_in || 3600) * 1000,
  })
  return { token: resp.access_token, email: grantedEmail }
}

async function fetchUserEmail(token: string): Promise<string> {
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) throw new Error(`Could not read account email (${r.status})`)
  const j = await r.json()
  if (!j.email) throw new Error('Google did not return an email address')
  return j.email as string
}

/** Gmail search query for transaction alerts from the configured senders. */
export function buildQuery(senders: string[], afterEpochSeconds: number): string {
  const from = senders
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' OR ')
  return `from:(${from}) after:${Math.floor(afterEpochSeconds)}`
}

async function gmailFetch(token: string, path: string): Promise<any> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  })
  if (r.status === 401) throw new Error('Gmail token expired — sync again to re-authorize')
  if (!r.ok) throw new Error(`Gmail API error ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

export async function listMessageIds(token: string, q: string, cap = 200): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ q, maxResults: '100' })
    if (pageToken) params.set('pageToken', pageToken)
    const j = await gmailFetch(token, `messages?${params}`)
    for (const m of j.messages ?? []) ids.push(m.id)
    pageToken = j.nextPageToken
  } while (pageToken && ids.length < cap)
  return ids.slice(0, cap)
}

export async function getMessage(token: string, id: string): Promise<EmailMessage> {
  const j = await gmailFetch(token, `messages/${id}?format=full`)
  const headers: Record<string, string> = {}
  for (const h of j.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value
  const body = extractBody(j.payload) || j.snippet || ''
  return {
    id,
    from: headers['from'] ?? '',
    subject: headers['subject'] ?? '',
    date: new Date(Number(j.internalDate)).toISOString(),
    body: body.slice(0, 5000),
  }
}

function extractBody(payload: any): string {
  if (!payload) return ''
  const parts = flattenParts(payload)
  const plain = parts.find((p) => p.mimeType === 'text/plain' && p.body?.data)
  if (plain) return decodeB64Url(plain.body.data)
  const html = parts.find((p) => p.mimeType === 'text/html' && p.body?.data)
  if (html) return htmlToText(decodeB64Url(html.body.data))
  return ''
}

function flattenParts(payload: any): any[] {
  const out: any[] = [payload]
  for (const p of payload.parts ?? []) out.push(...flattenParts(p))
  return out
}

function decodeB64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}
