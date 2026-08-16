'use client'

import { startAuthentication } from '@simplewebauthn/browser'
import { useActionState, useEffect, useState, useTransition } from 'react'

import { passkeySignIn, passkeySignInOptions, signInWithPassword } from '../app/auth-actions.ts'
import type { SignInState } from '../app/auth-actions.ts'
import { ceremonyError, passkeyBlocker } from './passkey-support.ts'

const INITIAL: SignInState = { error: null }

/**
 * Both ways in.
 *
 * The passkey is the everyday one and goes first. The password is underneath
 * and always works — it is the root of trust, and the thing that still gets you
 * in from a device that has never been here before.
 */
export function SignIn({ next, hasPasskeys }: { next: string; hasPasskeys: boolean }) {
  const [state, submit, submitting] = useActionState(signInWithPassword, INITIAL)
  const [passkeyError, setPasskeyError] = useState<string | null>(null)
  const [blocker, setBlocker] = useState<string | null>(null)
  const [busy, start] = useTransition()

  // After mount, never during render: see passkeyBlocker.
  useEffect(() => setBlocker(passkeyBlocker()), [])

  const usePasskey = () => {
    setPasskeyError(null)
    start(async () => {
      try {
        const options = await passkeySignInOptions()
        if (!options.ok) {
          setPasskeyError(options.error)
          return
        }
        const assertion = await startAuthentication({ optionsJSON: options.options })
        // Resolves only when the assertion was rejected; a good one redirects.
        const outcome = await passkeySignIn(assertion, next)
        if (outcome?.error) setPasskeyError(outcome.error)
      } catch (error) {
        setPasskeyError(ceremonyError(error))
      }
    })
  }

  return (
    <div className="signin-forms">
      <div className="signin-passkey">
        <button
          type="button"
          className="btn signin-btn"
          onClick={usePasskey}
          disabled={busy || blocker !== null}
        >
          {busy ? 'Waiting for the passkey…' : 'Use a passkey'}
        </button>

        {blocker !== null ? (
          <p className="note">{blocker}</p>
        ) : hasPasskeys ? null : (
          <p className="note">
            No passkeys are registered yet. Sign in with the password, then add one from Accounts.
          </p>
        )}

        {passkeyError && (
          <p className="note signin-error" role="alert">
            {passkeyError}
          </p>
        )}
      </div>

      <div className="signin-or">
        <span>or</span>
      </div>

      <form action={submit} className="signin-password">
        <input type="hidden" name="next" value={next} />

        <div className="field signin-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
          />
        </div>

        {/* Quiet only when a passkey is actually on offer. With none registered
            the password is not the fallback, it is the way in. */}
        <button
          className={`btn signin-btn${hasPasskeys ? ' btn-quiet' : ''}`}
          type="submit"
          disabled={submitting}
        >
          {submitting ? 'Checking…' : 'Sign in'}
        </button>

        {state.error && (
          <p className="note signin-error" role="alert">
            {state.error}
          </p>
        )}
      </form>
    </div>
  )
}
