/**
 * Ledger Cloudflare Worker:
 * 1. Encrypted cross-device sync blob storage in Cloudflare KV.
 * 2. AWS Bedrock Nova Lite proxy with SigV4 request signing.
 *
 * Endpoints:
 *   POST /api/bedrock or /bedrock -> Proxies to Amazon Bedrock Nova Lite
 *   GET  /:syncId                 -> Retrieves encrypted blob from KV
 *   PUT  /:syncId                 -> Stores encrypted blob in KV
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

const MAX_BYTES = 8 * 1024 * 1024 // 8 MB cap

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })

    const url = new URL(request.url)
    const cleanPath = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '')

    // Bedrock AI proxy route
    if (cleanPath === 'api/bedrock' || cleanPath === 'bedrock') {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)
      return handleBedrock(request, env)
    }

    // Encrypted sync KV storage routes
    const id = cleanPath.split('/')[0]
    if (!id || id.length < 16) {
      return json({ error: 'missing or invalid syncId / route' }, 400)
    }
    const key = `blob:${id}`

    if (request.method === 'GET') {
      if (!env.LEDGER) return json({ error: 'KV binding LEDGER not found' }, 500)
      const val = await env.LEDGER.get(key)
      if (val === null) return new Response('not found', { status: 404, headers: cors })
      return new Response(val, {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (request.method === 'PUT') {
      if (!env.LEDGER) return json({ error: 'KV binding LEDGER not found' }, 500)
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

async function handleBedrock(request, env) {
  try {
    const body = await request.json()
    const region = body.region || env.AWS_REGION || 'us-east-1'
    const modelId = body.modelId || 'amazon.nova-lite-v1:0'

    const accessKeyId = body.accessKeyId || env.AWS_ACCESS_KEY_ID
    const secretAccessKey = body.secretAccessKey || env.AWS_SECRET_ACCESS_KEY
    const sessionToken = body.sessionToken || env.AWS_SESSION_TOKEN

    if (!accessKeyId || !secretAccessKey) {
      return json(
        {
          error:
            'No AWS credentials provided. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY secrets on this Worker, or enter them in Settings.',
        },
        401,
      )
    }

    const client = new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
        sessionToken: sessionToken || undefined,
      },
    })

    const formattedMessages = (body.messages || []).map((msg) => ({
      role: msg.role,
      content: (msg.content || []).map((c) => {
        if (c.text !== undefined) return { text: c.text }
        if (c.image?.base64) {
          const binary = Uint8Array.from(atob(c.image.base64), (ch) => ch.charCodeAt(0))
          return {
            image: {
              format: c.image.format || 'png',
              source: { bytes: binary },
            },
          }
        }
        if (c.document?.base64) {
          const binary = Uint8Array.from(atob(c.document.base64), (ch) => ch.charCodeAt(0))
          const sanitizedName = (c.document.name || 'doc')
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .slice(0, 100)
          return {
            document: {
              format: c.document.format || 'pdf',
              name: sanitizedName,
              source: { bytes: binary },
            },
          }
        }
        return c
      }),
    }))

    const systemPrompt = body.system
      ? body.system.map((s) => (typeof s === 'string' ? { text: s } : s))
      : undefined

    const cmd = new ConverseCommand({
      modelId,
      messages: formattedMessages,
      system: systemPrompt,
      inferenceConfig: body.inferenceConfig || { temperature: 0, maxTokens: 4096 },
    })

    const response = await client.send(cmd)
    const text = response.output?.message?.content?.[0]?.text || ''

    return json({
      text,
      usage: response.usage,
      stopReason: response.stopReason,
    })
  } catch (err) {
    return json({ error: err.message || String(err) }, 500)
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
