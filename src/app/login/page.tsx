import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { SignIn } from '../../components/sign-in.tsx'
import { countPasskeys } from '../../lib/auth/passkeys.ts'
import { SESSION_COOKIE, authEnabled, safeNext, sessionIsValid } from '../../lib/auth/session.ts'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Sign in · Ledger' }

/**
 * The only page an unauthenticated visitor can reach, and therefore the only
 * page that must not say anything about the ledger. It sits outside the `(app)`
 * route group so the nav rail — which reports transaction counts and whether
 * the books reconcile — is not rendered above it.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const next = safeNext((await searchParams).next)

  // Nothing to sign in to when APP_PASSWORD is unset.
  if (!authEnabled()) redirect(next)

  const jar = await cookies()
  if (await sessionIsValid(jar.get(SESSION_COOKIE)?.value)) redirect(next)

  // True when we could not ask: better to say nothing than to tell someone no
  // passkeys are registered because the database happened to be down.
  const hasPasskeys = await countPasskeys()
    .then((count) => count > 0)
    .catch(() => true)

  return (
    <main className="signin">
      <div className="signin-card">
        <div className="signin-brand">
          <strong>Ledger</strong>
          <span>NZ</span>
        </div>

        <h1>Sign in</h1>
        <p>One household, one password. Passkeys are added to it, not instead of it.</p>

        <SignIn next={next} hasPasskeys={hasPasskeys} />
      </div>
    </main>
  )
}
