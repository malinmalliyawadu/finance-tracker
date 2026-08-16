'use client'

import { startRegistration } from '@simplewebauthn/browser'
import { useEffect, useState, useTransition } from 'react'

import { passkeyRegistrationOptions, registerPasskey } from '../app/auth-actions.ts'
import { ceremonyError, passkeyBlocker } from './passkey-support.ts'

/**
 * Registering a device.
 *
 * The name is asked for before the ceremony rather than guessed from the user
 * agent afterwards. "Chrome on macOS" is three identical rows on one desk; the
 * useful name is the one its owner would say out loud a year from now, standing
 * in front of this list deciding which one to delete.
 */
export function AddPasskey() {
  const [label, setLabel] = useState('')
  const [blocker, setBlocker] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const [busy, start] = useTransition()

  // After mount. Rendering the button behind this check would mean an unhydrated
  // page shows neither a button nor a reason there isn't one.
  useEffect(() => setBlocker(passkeyBlocker()), [])

  const add = () => {
    setError(null)
    setAdded(null)

    const name = label.trim()
    if (name === '') {
      setError('Give the passkey a name first.')
      return
    }

    start(async () => {
      try {
        const options = await passkeyRegistrationOptions()
        if (!options.ok) {
          setError(options.error)
          return
        }
        const attestation = await startRegistration({ optionsJSON: options.options })
        const result = await registerPasskey(attestation, name)
        if (result.error) {
          setError(result.error)
          return
        }
        setAdded(name)
        setLabel('')
      } catch (caught) {
        setError(ceremonyError(caught))
      }
    })
  }

  return (
    <div className="passkey-add">
      <div className="toolbar">
        <div className="field">
          <label htmlFor="passkey-label">Name it</label>
          <input
            id="passkey-label"
            name="label"
            value={label}
            maxLength={60}
            placeholder="my phone"
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                add()
              }
            }}
          />
        </div>

        <button type="button" className="btn" onClick={add} disabled={busy || blocker !== null}>
          {busy ? 'Waiting for the device…' : 'Add a passkey'}
        </button>
      </div>

      {blocker !== null && <p className="note passkey-blocked">{blocker}</p>}

      {error && (
        <p className="note signin-error" role="alert">
          {error}
        </p>
      )}

      {added && (
        <p className="note" role="status">
          Added <strong>{added}</strong>. It will be offered next time you sign in.
        </p>
      )}
    </div>
  )
}
