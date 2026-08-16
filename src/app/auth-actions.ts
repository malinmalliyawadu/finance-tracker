'use server'

import { revalidatePath } from 'next/cache'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'

import { clearAttempts, clientKey, takeAttempt } from '../lib/auth/rate-limit.ts'
import { deletePasskey } from '../lib/auth/passkeys.ts'
import {
  SESSION_COOKIE,
  appPassword,
  issueSession,
  passwordIsCorrect,
  safeNext,
  sessionCookieOptions,
  sessionIsValid,
} from '../lib/auth/session.ts'
import {
  finishAuthentication,
  finishRegistration,
  startAuthentication,
  startRegistration,
} from '../lib/auth/webauthn.ts'

/**
 * Whether the caller is signed in, asked here rather than trusted from the
 * route guard.
 *
 * Registering a passkey is the one operation that creates a new way in, so the
 * check that guards it belongs next to it: a guard that stops matching one day
 * — a matcher edited, a route moved — must not silently turn passkey
 * registration into something a stranger can do.
 */
async function signedIn(): Promise<boolean> {
  const jar = await cookies()
  return sessionIsValid(jar.get(SESSION_COOKIE)?.value)
}

async function setSession(): Promise<void> {
  const password = appPassword()
  if (password === null) return
  const jar = await cookies()
  jar.set(SESSION_COOKIE, await issueSession(password), sessionCookieOptions())
}

// ---------------------------------------------------------------------------
// password
// ---------------------------------------------------------------------------

export type SignInState = { error: string | null }

export async function signInWithPassword(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const next = safeNext(String(formData.get('next') ?? ''))
  const attempt = String(formData.get('password') ?? '')

  const key = clientKey(await headers())
  const allowance = takeAttempt(key)
  if (!allowance.allowed) {
    return {
      error: `Too many attempts. Try again in ${allowance.retryAfterSeconds} seconds.`,
    }
  }

  if (!(await passwordIsCorrect(attempt))) {
    return { error: 'That is not the password.' }
  }

  clearAttempts(key)
  await setSession()

  redirect(next)
}

export async function signOut(): Promise<void> {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  // The router cache holds rendered pages from the signed-in session. Without
  // this, going back lands on a page full of figures until it refetches.
  revalidatePath('/', 'layout')
  redirect('/login')
}

// ---------------------------------------------------------------------------
// passkeys: signing in
// ---------------------------------------------------------------------------

export type OptionsResult<T> = { ok: true; options: T } | { ok: false; error: string }

export async function passkeySignInOptions(): Promise<
  OptionsResult<PublicKeyCredentialRequestOptionsJSON>
> {
  try {
    return { ok: true, options: await startAuthentication() }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}

export async function passkeySignIn(
  response: AuthenticationResponseJSON,
  next: string,
): Promise<{ error: string }> {
  // Not rate limited. An assertion is a signature over a challenge this server
  // issued moments ago; there is nothing to guess, so a limit here would only
  // ever lock out the person holding the key.
  const verified = await finishAuthentication(response)
  if (!verified) return { error: 'That passkey was not recognised. Use the password instead.' }

  await setSession()

  redirect(safeNext(next))
}

// ---------------------------------------------------------------------------
// passkeys: registering
// ---------------------------------------------------------------------------

export async function passkeyRegistrationOptions(): Promise<
  OptionsResult<PublicKeyCredentialCreationOptionsJSON>
> {
  if (!(await signedIn())) return { ok: false, error: 'Sign in before adding a passkey.' }

  try {
    return { ok: true, options: await startRegistration() }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}

/**
 * Stores a verified passkey under the name its owner gave it.
 *
 * The session check is repeated here rather than assumed from the options call:
 * these are two separate requests, and the second one is the one that writes.
 */
export async function registerPasskey(
  response: RegistrationResponseJSON,
  label: string,
): Promise<{ error: string | null }> {
  if (!(await signedIn())) return { error: 'Sign in before adding a passkey.' }

  const name = label.trim()
  if (name === '') return { error: 'Give the passkey a name first.' }
  if (name.length > 60) return { error: 'That name is too long.' }

  try {
    await finishRegistration(response, name)
  } catch (error) {
    return { error: message(error) }
  }

  revalidatePath('/accounts')
  return { error: null }
}

export async function forgetPasskey(formData: FormData): Promise<void> {
  if (!(await signedIn())) return

  const credentialId = String(formData.get('credentialId') ?? '')
  if (credentialId === '') return

  await deletePasskey(credentialId)
  revalidatePath('/accounts')
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
