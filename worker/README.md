# Ledger sync Worker

A tiny Cloudflare Worker that stores one **encrypted blob** per sync id in KV. It is a dumb
key-value store — the blob is AES-GCM ciphertext produced in your browser, so this Worker (and
Cloudflare) never see your transactions in plaintext.

## Deploy (free, ~3 minutes)

You need a free Cloudflare account. From this `worker/` folder:

```sh
# 1. log in (opens a browser once)
npx wrangler login

# 2. create the KV namespace that holds the blobs
npx wrangler kv namespace create LEDGER
#    -> copy the printed id into wrangler.toml (id = "...")

# 3. deploy
npx wrangler deploy
#    -> prints your Worker URL, e.g. https://ledger-sync.<you>.workers.dev
```

## Connect the app

In Ledger → **Settings → Cloud sync**:

1. Paste the Worker URL from step 3.
2. Click **Generate** to create a sync id (an unguessable secret — keep it private).
3. Choose a strong **passphrase**. Your ledger is encrypted with it before it ever leaves the
   device; if you lose the passphrase the synced copy is unrecoverable by design.
4. On your **first device**, click **Push now**.
5. On your **other device**, enter the *same* Worker URL, sync id, and passphrase, then click
   **Pull now**.

Turn on **Auto sync** to pull on open and push a few seconds after any change.

## Security notes

- End-to-end encrypted: the server stores only ciphertext, an iv, a salt, and a timestamp.
- Access is gated by the unguessable sync id. Treat it like a password.
- Conflict handling is last-write-wins on the whole ledger — fine for one person across a couple
  of devices, not a multi-user merge engine.

## Cost

Comfortably inside Cloudflare's free tier (Workers: 100k requests/day; KV: 100k reads &
1k writes/day, 1 GB) for personal use.
