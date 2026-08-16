'use client'

import { browserSupportsWebAuthn } from '@simplewebauthn/browser'

/**
 * Why this browser cannot do passkeys, or null if it can.
 *
 * Only meaningful after mount. Callers render their button regardless and add
 * this next to it once they know — a capability check that runs during render
 * is false on the server and false again until hydration, which is how you get
 * a page with no button and no explanation on it.
 *
 * The secure-context case is checked first because it is the common one and the
 * least guessable: `window.PublicKeyCredential` is simply absent over plain
 * http, so a bare support check would blame the browser for the connection.
 * Reaching the app on a LAN address over http is exactly how that happens.
 */
export function passkeyBlocker(): string | null {
  if (typeof window === 'undefined') return null

  if (!window.isSecureContext) {
    return 'Passkeys need a secure connection. This page was loaded over plain http, so the browser will not offer them — reach the app over https, or on localhost.'
  }

  if (!browserSupportsWebAuthn()) {
    return 'This browser does not support passkeys.'
  }

  return null
}

/** Turns a WebAuthn exception into something worth reading. */
export function ceremonyError(error: unknown): string {
  if (error instanceof Error) {
    // Cancelling the browser prompt, and also the timeout, both land here.
    if (error.name === 'NotAllowedError') return 'That was cancelled.'
    if (error.name === 'InvalidStateError') {
      return 'This device already has a passkey for Ledger.'
    }
    return error.message
  }
  return String(error)
}
