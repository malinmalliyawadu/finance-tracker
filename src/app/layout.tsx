import type { Metadata } from 'next'
import localFont from 'next/font/local'

import './globals.css'

/**
 * The three families are committed to `src/fonts` rather than fetched from
 * Google at build time. `next/font/google` downloads the files during the
 * build, which made every production build depend on fonts.gstatic.com being
 * reachable from inside the Docker builder — and when it was not, the build
 * failed outright rather than degrading to a fallback face. See
 * `src/fonts/README.md` for what each file is and how to refresh it.
 */
const display = localFont({
  src: '../fonts/bricolage-grotesque-latin-600-700.woff2',
  weight: '600 700',
  style: 'normal',
  variable: '--font-display',
  display: 'swap',
})

const body = localFont({
  src: '../fonts/public-sans-latin-400-700.woff2',
  weight: '400 700',
  style: 'normal',
  variable: '--font-body',
  display: 'swap',
})

// IBM Plex Mono has no variable cut on Google Fonts, so it is three static
// weights rather than one range.
const mono = localFont({
  src: [
    { path: '../fonts/ibm-plex-mono-latin-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/ibm-plex-mono-latin-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/ibm-plex-mono-latin-600.woff2', weight: '600', style: 'normal' },
  ],
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
