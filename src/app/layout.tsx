import type { Metadata } from 'next'
import { Bricolage_Grotesque, IBM_Plex_Mono, Public_Sans } from 'next/font/google'

import './globals.css'

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-display',
  display: 'swap',
})

const body = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
})

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Ledger',
  description: 'What I actually spend, after the money that only looks like spending.',
}

/**
 * Document, fonts and stylesheet, and deliberately nothing else.
 *
 * The nav rail reports how many transactions there are and whether the ledger
 * reconciles. In a root layout those figures would render on the login page —
 * the one page a stranger can reach — so the shell lives in `(app)/layout.tsx`,
 * one level below this, and the login page sits outside it. Route groups do not
 * appear in URLs, so nothing moved as far as the browser is concerned.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NZ" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
