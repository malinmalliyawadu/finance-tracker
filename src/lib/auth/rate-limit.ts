/**
 * Password attempt throttling. In memory, because the thing being defended is
 * one household's app behind one container, and a table would mean a write on
 * every failed attempt for no additional protection.
 *
 * Only passwords are limited. A passkey assertion cannot be guessed — it is a
 * signature over a challenge this server issued — so rate limiting one would
 * only ever lock out the person holding the key.
 */

const MAX_ATTEMPTS = 8
const WINDOW_MS = 60_000

/** Cached on globalThis so a dev-mode hot reload does not hand out a fresh allowance. */
const globalForLimiter = globalThis as unknown as { ledgerAttempts?: Map<string, number[]> }

function attempts(): Map<string, number[]> {
  if (!globalForLimiter.ledgerAttempts) globalForLimiter.ledgerAttempts = new Map()
  return globalForLimiter.ledgerAttempts
}

/**
 * Which client an attempt is charged to.
 *
 * The **rightmost** x-forwarded-for entry, not the leftmost. Clients can send
 * the header themselves and proxies append rather than replace, so the leftmost
 * value is whatever the attacker wrote — rate limiting on it means a new
 * identity per request. The rightmost entry is the one the closest proxy added,
 * which is the only part of the header the attacker did not choose.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (!forwarded) return 'direct'

  const entries = forwarded.split(',').map((entry) => entry.trim()).filter(Boolean)
  return entries.at(-1) ?? 'direct'
}

export type Allowance = { allowed: true } | { allowed: false; retryAfterSeconds: number }

/** Records an attempt and says whether it is allowed. Call once per attempt. */
export function takeAttempt(key: string, now = Date.now()): Allowance {
  const store = attempts()
  const recent = (store.get(key) ?? []).filter((at) => now - at < WINDOW_MS)

  if (recent.length >= MAX_ATTEMPTS) {
    store.set(key, recent)
    const oldest = recent[0]!
    return { allowed: false, retryAfterSeconds: Math.ceil((WINDOW_MS - (now - oldest)) / 1000) }
  }

  recent.push(now)
  store.set(key, recent)

  // Keys are client addresses and the window is a minute, so the map is tiny in
  // normal use. Sweeping on write keeps a burst of forged addresses from being
  // a way to grow it without bound.
  if (store.size > 512) {
    for (const [existing, times] of store) {
      if (times.every((at) => now - at >= WINDOW_MS)) store.delete(existing)
    }
  }

  return { allowed: true }
}

/** Forgets a client's failures. Called on a successful sign-in. */
export function clearAttempts(key: string): void {
  attempts().delete(key)
}
