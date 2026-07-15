/**
 * Ledger sync Worker — a dumb encrypted-blob store.
 *
 * It stores and returns one opaque JSON payload per syncId in Cloudflare KV.
 * The payload's `blob` is AES-GCM ciphertext produced in the browser, so this
 * Worker (and Cloudflare) never see your transactions in plaintext.
 *
 *   GET  /:syncId  -> 200 payload | 404 if none
 *   PUT  /:syncId  -> 204, stores the JSON body
 *
 * Security model: the syncId is an unguessable secret. Anyone who has it can
 * read/overwrite the ciphertext, but cannot decrypt it without your passphrase.
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

const MAX_BYTES = 8 * 1024 * 1024 // generous cap for a personal ledger

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })

    const id = new URL(request.url).pathname.replace(/^\/+/, '').split('/')[0]
    if (!id || id.length < 16) {
      return json({ error: 'missing or too-short syncId' }, 400)
    }
    const key = `blob:${id}`

    if (request.method === 'GET') {
      const val = await env.LEDGER.get(key)
      if (val === null) return new Response('not found', { status: 404, headers: cors })
      return new Response(val, {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (request.method === 'PUT') {
      const body = await request.text()
      if (body.length > MAX_BYTES) return json({ error: 'payload too large' }, 413)
      try {
        const p = JSON.parse(body)
        if (!p || typeof p.version !== 'number' || !p.blob) {
          return json({ error: 'invalid payload' }, 400)
        }
      } catch {
        return json({ error: 'body must be JSON' }, 400)
      }
      await env.LEDGER.put(key, body)
      return new Response(null, { status: 204, headers: cors })
    }

    return json({ error: 'method not allowed' }, 405)
  },
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
