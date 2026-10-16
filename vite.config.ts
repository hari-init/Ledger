import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'

function bedrockProxyPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'vite-plugin-bedrock',
    configureServer(server) {
      server.middlewares.use('/api/bedrock', (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        const chunks: Buffer[] = []
        req.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })

        req.on('end', async () => {
          try {
            const rawBody = Buffer.concat(chunks).toString('utf-8')
            const body = JSON.parse(rawBody || '{}')

            const region =
              body.region ||
              env.AWS_REGION ||
              env.AWS_DEFAULT_REGION ||
              process.env.AWS_REGION ||
              process.env.AWS_DEFAULT_REGION ||
              'us-east-1'

            const modelId = body.modelId || 'amazon.nova-lite-v1:0'

            const accessKeyId =
              body.accessKeyId || env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID
            const secretAccessKey =
              body.secretAccessKey ||
              env.AWS_SECRET_ACCESS_KEY ||
              process.env.AWS_SECRET_ACCESS_KEY
            const sessionToken =
              body.sessionToken || env.AWS_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN

            const clientConfig: {
              region: string
              credentials?: {
                accessKeyId: string
                secretAccessKey: string
                sessionToken?: string
              }
            } = { region }

            if (accessKeyId && secretAccessKey) {
              clientConfig.credentials = {
                accessKeyId,
                secretAccessKey,
                sessionToken: sessionToken || undefined,
              }
            }

            const client = new BedrockRuntimeClient(clientConfig)

            // Convert incoming messages into ConverseCommand format (base64 -> Uint8Array)
            const formattedMessages = (body.messages || []).map((msg: any) => ({
              role: msg.role,
              content: (msg.content || []).map((c: any) => {
                if (c.text !== undefined) return { text: c.text }
                if (c.image?.base64) {
                  return {
                    image: {
                      format: c.image.format || 'png',
                      source: { bytes: Buffer.from(c.image.base64, 'base64') },
                    },
                  }
                }
                if (c.document?.base64) {
                  const sanitizedName = (c.document.name || 'doc')
                    .replace(/[^a-zA-Z0-9_-]/g, '_')
                    .slice(0, 100)
                  return {
                    document: {
                      format: c.document.format || 'pdf',
                      name: sanitizedName,
                      source: { bytes: Buffer.from(c.document.base64, 'base64') },
                    },
                  }
                }
                return c
              }),
            }))

            const systemPrompt = body.system
              ? body.system.map((s: any) => (typeof s === 'string' ? { text: s } : s))
              : undefined

            const cmd = new ConverseCommand({
              modelId,
              messages: formattedMessages,
              system: systemPrompt,
              inferenceConfig: body.inferenceConfig || { temperature: 0, maxTokens: 4096 },
            })

            const response = await client.send(cmd)
            const text = response.output?.message?.content?.[0]?.text || ''

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                text,
                usage: response.usage,
                stopReason: response.stopReason,
              }),
            )
          } catch (err: any) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message || String(err) }))
          }
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      vue(),
      tailwindcss(),
      bedrockProxyPlugin(env),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'Ledger',
          short_name: 'Ledger',
          description: 'Personal expense tracker — email-synced, on-device.',
          theme_color: '#131311',
          background_color: '#f6f4ee',
          display: 'standalone',
          orientation: 'portrait',
          scope: '/',
          start_url: '/',
          icons: [
            { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
        workbox: {
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api/],
          skipWaiting: true,
          clientsClaim: true,
        },
      }),
    ],
  }
})
