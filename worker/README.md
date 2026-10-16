# Ledger Cloudflare Worker

A lightweight Cloudflare Worker that provides:
1. **AWS Bedrock Nova Lite Proxy**: Signs requests with AWS SigV4 server-side and routes them to Amazon Bedrock (`amazon.nova-lite-v1:0`), completely resolving browser CORS constraints.
2. **Encrypted Cross-Device Sync**: Stores end-to-end encrypted AES-GCM transaction blobs in Cloudflare KV. The Worker and Cloudflare never see your data in plaintext.

---

## Deploy (free, ~3 minutes)

From this `worker/` directory:

```sh
# 1. Log in to your free Cloudflare account (opens browser once)
npx wrangler login

# 2. (Optional, if setting up sync) Create the KV namespace for encrypted blobs:
npx wrangler kv namespace create LEDGER
# Copy the printed id into wrangler.toml (id = "...")

# 3. (Optional) Set AWS secrets on the Worker so you don't need keys in your browser:
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY

# 4. Deploy:
npx wrangler deploy
```

Wrangler will print your deployed Worker URL:
`https://ledger-sync.<your-subdomain>.workers.dev`

---

## Connect to Ledger

### 1. For Bedrock Nova Lite AI
In Ledger → **Settings → AI Engine**:
* Set **Proxy Endpoint** to your Worker URL:  
  `https://ledger-sync.<your-subdomain>.workers.dev/api/bedrock`
* Click **Test Bedrock connection** to verify!

### 2. For Encrypted Cross-Device Sync
In Ledger → **Settings → Cloud sync**:
1. Paste your Worker URL: `https://ledger-sync.<your-subdomain>.workers.dev`
2. Click **Generate** to create a sync ID.
3. Choose a strong **passphrase** (used for local AES-GCM encryption before sending).
4. Click **Push now** on your first device, and **Pull now** on other devices.
5. Turn on **Auto sync** to sync automatically in the background.

---

## Security & Costs

* **Zero Plaintext Storage**: Sync payloads are AES-256-GCM ciphertext encrypted locally on-device.
* **AWS Credential Isolation**: AWS keys can be stored directly as encrypted Worker secrets (`wrangler secret put`), never exposed to client browsers.
* **Free Tier**: Comfortably operates within Cloudflare's generous free tier (100,000 requests/day).
