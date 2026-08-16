'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { signOut } from '../app/auth-actions.ts'
import type { Health } from '../lib/queries.ts'
import { moneyWhole } from '../lib/format.ts'

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/categories', label: 'Categories' },
  { href: '/budget', label: 'Budget' },
  { href: '/recurring', label: 'Recurring' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/large', label: 'Large purchases' },
  { href: '/accounts', label: 'Accounts' },
]

export function Rail({ health, canSignOut }: { health: Health | null; canSignOut: boolean }) {
  const pathname = usePathname()

  return (
    <nav className="rail" aria-label="Sections">
      <div className="rail-brand">
        <strong>Ledger</strong>
        <span>NZ</span>
      </div>

      <div className="rail-nav">
        {LINKS.map((link) => {
          const current = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href)
          return (
            <Link
              key={link.href}
              href={link.href}
              className="rail-link"
              aria-current={current ? 'page' : undefined}
            >
              {link.label}
            </Link>
          )
        })}
      </div>

      <div className="rail-bottom">
        {health && (
          <div className="rail-foot">
            <div>
              {health.transactions.toLocaleString('en-NZ')} transactions,{' '}
              <span className="num">{(health.coverage * 100).toFixed(1)}%</span> categorised
            </div>
            <div>
              {health.drift === 0 ? (
                <>Reconciles to <span className="num">$0.00</span></>
              ) : (
                <span style={{ color: 'var(--alert)' }}>
                  Out by <span className="num">{moneyWhole(health.drift)}</span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* A form, not a link. A GET that ends the session can be triggered by
            anything that fetches a URL — a prefetch, an image tag on another
            site — and signing someone out is a state change. */}
        {canSignOut && (
          <form action={signOut} className="rail-signout">
            <button type="submit" className="btn btn-quiet rail-signout-btn">
              Sign out
            </button>
          </form>
        )}
      </div>
    </nav>
  )
}
