/**
 * Signed tickets: the one primitive every cookie in this app is built from.
 *
 * A ticket carries a value, an expiry, and an HMAC over both, keyed by
 * APP_PASSWORD itself. There is deliberately no second secret to distribute.
 * Three things fall out of keying on the password:
 *
 *   - a stolen cookie is a stolen session, not a stolen password, because the
 *     ticket contains no part of the key;
 *   - there is nothing extra to set, so a deployment cannot half-work because
 *     someone forgot a SESSION_SECRET;
 *   - changing the password invalidates every ticket ever issued, which is what
 *     "sign all my devices out" means, for free.
 *
 * Web Crypto rather than node:crypto, because the same code runs in middleware
 * (edge runtime) and in server actions (node), and node:crypto is not there in
 * the first of those.
 *
 * The purpose is part of the signed payload, not part of the key. Sessions and
 * both halves of each WebAuthn ceremony are signed with the same key, so the
 * purpose string is the only thing stopping a registration challenge from being
 * answered with a sign-in assertion. tests/ticket.test.ts pins that down.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type Purpose = 'session' | 'register' | 'authenticate'

/** Every ticket looks like `value.expiry.signature`, each part base64url. */
const PART_COUNT = 3

export type SignOptions = {
  key: string
  purpose: Purpose
  /** Free-form, opaque to this module. Empty for a session, a challenge for a ceremony. */
  value?: string
  ttlSeconds: number
  now?: number
}

export type ReadOptions = {
  key: string
  purpose: Purpose
  ticket: string | undefined | null
  now?: number
}

/** Mints a ticket that expires `ttlSeconds` from now. */
export async function signTicket(options: SignOptions): Promise<string> {
  const { key, purpose, value = '', ttlSeconds, now = Date.now() } = options

  const payload = toBase64Url(encoder.encode(`${purpose}:${value}`))
  const expiry = String(now + ttlSeconds * 1000)
  const signature = await hmac(key, `${payload}.${expiry}`)

  return `${payload}.${expiry}.${toBase64Url(signature)}`
}

/**
 * Returns the value carried by a ticket, or null if it is not a ticket this
 * key signed, for this purpose, and still within its expiry.
 *
 * Null for every failure on purpose: a caller that cannot tell "expired" from
 * "forged" cannot accidentally treat one of them as recoverable.
 */
export async function readTicket(options: ReadOptions): Promise<string | null> {
  const { key, purpose, ticket, now = Date.now() } = options
  if (!ticket) return null

  const parts = ticket.split('.')
  if (parts.length !== PART_COUNT) return null

  const [payload, expiry, signature] = parts as [string, string, string]

  // Signature first. Checking the expiry before the signature would answer
  // "is this a well-formed ticket" for anyone holding a forgery.
  const expected = await hmac(key, `${payload}.${expiry}`)
  const provided = fromBase64Url(signature)
  if (provided === null || !equalBytes(expected, provided)) return null

  // Signed, so the digits are ours — but a hand-written expiry of "1e999" or
  // "" would still survive the signature check if it were signed by us, and
  // Number() is happy to make either of those into something ordered.
  if (!/^\d+$/.test(expiry) || now >= Number(expiry)) return null

  const body = fromBase64Url(payload)
  if (body === null) return null

  const text = decoder.decode(body)
  const prefix = `${purpose}:`
  if (!text.startsWith(prefix)) return null

  return text.slice(prefix.length)
}

/**
 * Whether two secrets match, without leaking how far the comparison got.
 *
 * Digests rather than the strings themselves: a byte-wise comparison of raw
 * passwords is constant time only for a given pair of lengths, and bailing out
 * early on a length mismatch tells an attacker the length. Hashing both to a
 * fixed 32 bytes removes the question.
 */
export async function secretsMatch(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(a), sha256(b)])
  return equalBytes(left, right)
}

async function hmac(key: string, message: string): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', material, encoder.encode(message))
  return new Uint8Array(signature)
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

/** Constant time for equal-length inputs, which is the only case that reaches it. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i += 1) difference |= a[i]! ^ b[i]!
  return difference === 0
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Null rather than throwing: junk arrives in cookies as a matter of course. */
export function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}
