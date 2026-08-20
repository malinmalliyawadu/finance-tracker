'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { signOut } from '../app/auth-actions.ts'
import type { Health } from '../lib/queries.ts'
import { moneyWhole } from '../lib/format.ts'

/**
 * Two navigations, because a phone and a laptop are not the same instrument.
 *
 * On a laptop the rail is a list down the side: there is room for one, and
 * reading down seven labels is faster than reading across them. On a phone that
 * list became a row that scrolled sideways, which is a desktop nav in a
 * costume — the last two links sat past the right edge with nothing to say they
 * were there, and reaching any of them meant a scroll with the hand that is
 * also holding the phone. Below 760px the rail keeps only the brand and two
 * icons, and the five links worth having under a thumb move to a fixed bar at
 * the bottom of the screen.
 *
 * Five, not seven: Large purchases and Accounts are things you do when setting
 * up or reviewing, not on the bus, so they keep icons in the top bar instead of
 * each taking a sixth of the thumb row.
 */

/**
 * `short` is only for the tab bar, and only where the rail's label will not fit
 * a fifth of a phone. It is deliberately not a chance to rename anything: a tab
 * reading "Spending" that opens a page headed "Categories" is a worse problem
 * than a long word, so the two stay the same word wherever they can.
 */
type Item = { href: string; label: string; short?: string; icon: keyof typeof ICONS }

const PRIMARY: Item[] = [
  { href: '/', label: 'Dashboard', short: 'Home', icon: 'home' },
  { href: '/categories', label: 'Categories', icon: 'donut' },
  { href: '/budget', label: 'Budget', icon: 'target' },
  { href: '/recurring', label: 'Recurring', icon: 'repeat' },
  { href: '/transactions', label: 'Transactions', icon: 'list' },
]

const SECONDARY: Item[] = [
  { href: '/large', label: 'Large purchases', icon: 'sparkle' },
  { href: '/accounts', label: 'Accounts', icon: 'bank' },
]

const ICONS = {
  home: <path d="M3 10.2 12 3l9 7.2M5.5 8.6V20h13V8.6M9.8 20v-5.6h4.4V20" />,
  donut: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 3.6v5M18 8.2l-3.6 2.6" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="4.4" />
      <circle cx="12" cy="12" r="0.6" />
    </>
  ),
  repeat: <path d="M4 8h11.5a3.5 3.5 0 0 1 0 7H12m8-7-3-3m3 3-3 3M20 16H8.5a3.5 3.5 0 0 1 0-7H12" />,
  list: (
    <>
      <path d="M4 7h11M4 12h16M4 17h8" />
      <circle cx="18.5" cy="17" r="2.6" />
      <path d="m20.6 19.1 1.4 1.4" />
    </>
  ),
  sparkle: (
    <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9 10.1 9zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  ),
  bank: <path d="M3.5 9.4 12 4.5l8.5 4.9M5 10.6v7.9M10 10.6v7.9M14 10.6v7.9M19 10.6v7.9M3.2 19.5h17.6" />,
  out: <path d="M14.5 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4M10 8l-4 4 4 4M6 12h9" />,
} as const

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden>
      {ICONS[name]}
    </svg>
  )
}

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

export function Rail({ health, canSignOut }: { health: Health | null; canSignOut: boolean }) {
  const pathname = usePathname()

  return (
    <nav className="rail" aria-label="Sections">
      <Link href="/" className="rail-brand">
        <strong>Ledger</strong>
        <span>NZ</span>
      </Link>

      <div className="rail-nav">
        {[...PRIMARY, ...SECONDARY].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rail-link"
            aria-current={isActive(pathname, link.href) ? 'page' : undefined}
          >
            <Icon name={link.icon} />
            {link.label}
          </Link>
        ))}
      </div>

      {/* The phone top bar's right-hand side. These are the controls the tab bar
          below has no room for, and the ones the rail's own foot would carry on
          a laptop — where this whole strip is hidden. */}
      <div className="rail-quick">
        {SECONDARY.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rail-quick-link"
            aria-label={link.label}
            aria-current={isActive(pathname, link.href) ? 'page' : undefined}
          >
            <Icon name={link.icon} />
          </Link>
        ))}

        {canSignOut && (
          <form action={signOut}>
            <button type="submit" className="rail-quick-link" aria-label="Sign out">
              <Icon name="out" />
            </button>
          </form>
        )}
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
                <>
                  Reconciles to <span className="num">$0.00</span>
                </>
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

/**
 * The phone's thumb row. Renders on every width and is hidden above 760px, so
 * there is one nav in the markup at any size and nothing to keep in sync beyond
 * the PRIMARY list both read from.
 */
export function TabBar() {
  const pathname = usePathname()

  return (
    <nav className="tabbar" aria-label="Sections">
      {PRIMARY.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="tab"
          aria-current={isActive(pathname, item.href) ? 'page' : undefined}
        >
          <Icon name={item.icon} />
          {item.short ?? item.label}
        </Link>
      ))}
    </nav>
  )
}
