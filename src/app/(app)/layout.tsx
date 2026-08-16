import { Rail } from '../../components/rail.tsx'
import { authEnabled } from '../../lib/auth/session.ts'
import { getHealth } from '../../lib/queries.ts'

/**
 * The app shell. Everything gated sits under here; the login page does not,
 * because the rail carries totals from the ledger and those are exactly what
 * someone who has not signed in must not see.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const health = await getHealth().catch(() => null)

  return (
    <div className="shell">
      {/* No sign-out control when there is nothing to sign out of: with
          APP_PASSWORD unset the app is open and the button would do nothing. */}
      <Rail health={health} canSignOut={authEnabled()} />
      <main className="main">{children}</main>
    </div>
  )
}
