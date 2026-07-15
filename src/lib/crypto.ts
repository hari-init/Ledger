// End-to-end encryption for cloud sync. Everything here runs in the browser;
// the sync server only ever receives the ciphertext produced below.

const enc = new TextEncoder()
const dec = new TextDecoder()

// PBKDF2 work factor — high enough to make brute-forcing a stolen blob slow.
const PBKDF2_ITERATIONS = 600_000

// WebCrypto accepts these Uint8Arrays at runtime; the cast satisfies the
// stricter ArrayBuffer-vs-ArrayBufferLike typing in recent TS lib.dom.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource

export interface EncryptedBlob {
  v: 1
  /** base64 PBKDF2 salt */
  salt: string
  /** base64 AES-GCM iv */
  iv: string
  /** base64 ciphertext (AES-GCM, includes auth tag) */
  ct: string
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    bs(enc.encode(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: bs(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptJSON(obj: unknown, passphrase: string): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const data = enc.encode(JSON.stringify(obj))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bs(iv) }, key, bs(data))
  return { v: 1, salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) }
}

/** Throws if the passphrase is wrong or the blob is corrupt (AES-GCM auth fails). */
export async function decryptJSON<T>(blob: EncryptedBlob, passphrase: string): Promise<T> {
  const key = await deriveKey(passphrase, fromB64(blob.salt))
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bs(fromB64(blob.iv)) },
      key,
      bs(fromB64(blob.ct)),
    )
    return JSON.parse(dec.decode(pt)) as T
  } catch {
    throw new Error('Wrong passphrase, or the synced data is corrupt')
  }
}

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function fromB64(str: string): Uint8Array {
  const s = atob(str)
  const a = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i)
  return a
}
