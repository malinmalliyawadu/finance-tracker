// Server-only. The two WebAuthn ceremonies, and the short-lived cookie that
// carries the challenge between each one's two halves.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { cookies, headers } from 'next/headers'

import { findPasskey, listPasskeys, recordUse, savePasskey } from './passkeys.ts'
import { appPassword, requestOrigin } from './session.ts'
import { readTicket, signTicket } from './ticket.ts'

/**
 * There is one identity here, so the user handle is a constant.
 *
 * A stable handle is what makes registering a second passkey on a device that
 * already has one *replace* it rather than pile up a second indistinguishable
 * entry in the platform's list.
 */
const USER_ID = new TextEncoder().encode('ledger-household')
const USER_NAME = 'ledger'

/** Long enough to find a security key in a drawer, short enough to be a moment. */
const CHALLENGE_TTL_SECONDS = 5 * 60

const CHALLENGE_COOKIE: Record<'register' | 'authenticate', string> = {
  register: 'ledger_register_challenge',
  authenticate: 'ledger_auth_challenge',
}

export type RelyingParty = { rpID: string; origin: string }

/**
 * Which domain these credentials belong to, and which origin may use them.
 *
 * Derived from the request rather than configured, because the same image runs
 * on localhost, on a LAN address and behind a domain, and a hardcoded RP ID
 * turns two of those into a silent failure. x-forwarded-* is honoured because
 * the deployed topology puts a proxy in front: the Host the app receives is the
 * container's, and the browser signed over the one it typed.
 *
 * WEBAUTHN_RP_ID exists for the one case derivation cannot handle — a
 * deployment answering on several hostnames, where credentials registered on
 * one should work on the others, which requires naming the shared parent.
 */
export async function relyingParty(): Promise<RelyingParty> {
  const { host, origin } = requestOrigin(await headers())

  // The RP ID is a domain, so the port is not part of it. The origin is an
  // origin, so it is.
  const rpID = process.env.WEBAUTHN_RP_ID?.trim() || host.split(':')[0] || 'localhost'

  return { rpID, origin }
}

// ---------------------------------------------------------------------------
// the challenge cookie
// ---------------------------------------------------------------------------

/**
 * The challenge lives in a signed ticket, the same mechanism as the session and
 * keyed by the same password. Not in memory, because a container restart
 * between the two halves of a ceremony would otherwise fail a legitimate
 * sign-in, and not unsigned, because a challenge the client picks is not a
 * challenge.
 *
 * The purpose is baked into the payload. Both cookies are signed with the same
 * key, so a `register:` ticket and an `authenticate:` ticket are otherwise
 * indistinguishable — and answering a registration challenge with a sign-in
 * assertion is exactly the confusion that would let an unauthenticated visitor
 * mint a session. tests/ticket.test.ts covers the case directly.
 */
async function issueChallenge(purpose: 'register' | 'authenticate', challenge: string): Promise<void> {
  const key = requirePassword()
  const jar = await cookies()

  jar.set(CHALLENGE_COOKIE[purpose], await signTicket({ key, purpose, value: challenge, ttlSeconds: CHALLENGE_TTL_SECONDS }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CHALLENGE_TTL_SECONDS,
  })
}

/**
 * Reads and destroys a challenge. Deleted whether or not it verifies, so a
 * failed attempt cannot be retried against the same challenge and every
 * ceremony costs exactly one.
 */
async function takeChallenge(purpose: 'register' | 'authenticate'): Promise<string | null> {
  const jar = await cookies()
  const name = CHALLENGE_COOKIE[purpose]
  const ticket = jar.get(name)?.value

  jar.delete(name)

  return readTicket({ key: requirePassword(), purpose, ticket })
}

function requirePassword(): string {
  const password = appPassword()
  if (password === null) {
    // Passkeys are a way of presenting the password. With no password set there
    // is no gate, nothing for a passkey to open, and no key to sign with.
    throw new Error('APP_PASSWORD is not set, so there is nothing for a passkey to unlock.')
  }
  return password
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

export async function startRegistration(): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID } = await relyingParty()
  const existing = await listPasskeys()

  const options = await generateRegistrationOptions({
    rpName: 'Ledger',
    rpID,
    userID: USER_ID,
    userName: USER_NAME,
    userDisplayName: 'Ledger',
    attestationType: 'none',
    // So an authenticator that already holds a key for this app says so instead
    // of quietly registering a second one.
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      // Discoverable, because sign-in offers no credential list to choose from.
      residentKey: 'required',
      // Preferred rather than required: see finishRegistration.
      userVerification: 'preferred',
    },
  })

  await issueChallenge('register', options.challenge)

  return options
}

export async function finishRegistration(
  response: RegistrationResponseJSON,
  label: string,
): Promise<void> {
  const expectedChallenge = await takeChallenge('register')
  if (expectedChallenge === null) {
    throw new Error('That registration took too long or was started somewhere else. Try again.')
  }

  const { rpID, origin } = await relyingParty()

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    // A security key with no PIN cannot verify a user, and a hard requirement
    // turns that into an unexplained failure at the browser prompt. Possession
    // of the key is the factor being added; the password is still the root.
    requireUserVerification: false,
  })

  if (!verification.verified) throw new Error('That passkey could not be verified.')

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

  await savePasskey({
    credentialId: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: credential.transports ?? [],
    label,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
  })
}

// ---------------------------------------------------------------------------
// authentication
// ---------------------------------------------------------------------------

export async function startAuthentication(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = await relyingParty()

  const options = await generateAuthenticationOptions({
    rpID,
    // Empty on purpose: the browser offers whatever it holds for this domain,
    // and the response names the credential. Listing them instead would mean
    // handing the credential ids of every registered device to anyone who can
    // load the login page.
    allowCredentials: [],
    userVerification: 'preferred',
  })

  await issueChallenge('authenticate', options.challenge)

  return options
}

/** True when the assertion is genuine. The caller mints the session. */
export async function finishAuthentication(response: AuthenticationResponseJSON): Promise<boolean> {
  const expectedChallenge = await takeChallenge('authenticate')
  if (expectedChallenge === null) return false

  const passkey = await findPasskey(response.id)
  if (!passkey) return false

  const { rpID, origin } = await relyingParty()

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credentialId,
        // Copied rather than passed through: postgres hands back a Buffer,
        // which is a Uint8Array over an ArrayBufferLike, and the library's
        // signature is narrower than that.
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: false,
    })
  } catch {
    // A counter that went backwards throws here, and so does a malformed
    // response. Both are "no" as far as the login page is concerned.
    return false
  }

  if (!verification.verified) return false

  const { newCounter, credentialBackedUp } = verification.authenticationInfo
  await recordUse(passkey.credentialId, newCounter, credentialBackedUp)

  return true
}
