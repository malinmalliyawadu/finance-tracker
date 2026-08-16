'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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

export function Rail({ health }: { health: Health | null }) {
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
    </nav>
  )
}
