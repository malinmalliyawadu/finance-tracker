/**
 * The session, and the switch that turns authentication on at all.
 *
 * Nothing here may import the database or anything from node:*. This module is
 * reached from middleware, which runs in the edge runtime, as well as from
 * server actions and pages.
 */

import { readTicket, secretsMatch, signTicket } from './ticket.ts'

export const SESSION_COOKIE = 'ledger_session'

/** Thirty days. Long enough that the household is not typing a password weekly. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

/**
 * The whole configuration is this one variable.
 *
 * Read on every call rather than captured at module load, so an image built
 * without secrets and run with them behaves the way its environment says it
 * should. Building and running are different moments and only one of them is
 * supposed to have the password.
 *
 * Whitespace-only counts as unset: an empty value in a deployment UI is the
 * shape "I have not filled this in yet" takes, and treating it as a password
 * would gate the app behind a secret nobody knows.
 */
export function appPassword(): string | null {
  const value = process.env.APP_PASSWORD
  return value && value.trim() !== '' ? value : null
}

/** Unset APP_PASSWORD and the app is open, which is what a throwaway local database wants. */
export function authEnabled(): boolean {
  return appPassword() !== null
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  }
}

export async function issueSession(password: string): Promise<string> {
  return signTicket({ key: password, purpose: 'session', ttlSeconds: SESSION_TTL_SECONDS })
}

/** True when the cookie is a session ticket signed by the password currently in force. */
export async function sessionIsValid(ticket: string | undefined | null): Promise<boolean> {
  const password = appPassword()
  if (password === null) return true
  return (await readTicket({ key: password, purpose: 'session', ticket })) !== null
}

export async function passwordIsCorrect(attempt: string): Promise<boolean> {
  const password = appPassword()
  if (password === null) return true
  return secretsMatch(attempt, password)
}

/**
 * The scheme and host the browser actually asked for.
 *
 * Not derivable from the request URL: behind a reverse proxy — the deployed
 * topology — the app sees the address its own container is bound to, and Next
 * builds `request.url` from that rather than from the Host header. Anything
 * that has to name the site back to the browser (a redirect, a WebAuthn
 * relying party) has to read the forwarded headers itself.
 *
 * Proxies append, so the leftmost entry is the browser-facing one. That is the
 * opposite end of the list from x-forwarded-for, where the leftmost value is
 * the one the client could have written — different headers, different rules.
 */
export function requestOrigin(headers: Headers): { host: string; proto: string; origin: string } {
  const first = (value: string | null) => value?.split(',')[0]?.trim() || null

  const host = first(headers.get('x-forwarded-host')) ?? headers.get('host') ?? 'localhost'
  const proto = first(headers.get('x-forwarded-proto')) ?? 'http'

  return { host, proto, origin: `${proto}://${host}` }
}

/**
 * Where to send someone after they sign in.
 *
 * Only a path, and only one that starts with a single slash. `//evil.example`
 * and `/\evil.example` are both read as protocol-relative URLs by browsers, so
 * without this the login page would be an open redirect to a lookalike domain —
 * on the one page a stranger is allowed to reach.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value) return '/'
  if (!value.startsWith('/')) return '/'
  if (value.startsWith('//') || value.startsWith('/\\')) return '/'
  return value
}
