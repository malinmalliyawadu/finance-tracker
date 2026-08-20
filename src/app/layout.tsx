import type { Metadata, Viewport } from 'next'
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
  applicationName: 'Ledger',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Ledger',
    // Not `black-translucent`, which is the one that gets reached for to make a
    // web app look edge-to-edge: it draws the status bar over the page in white
    // text, and this app's ground is `--paper`, so in light mode the clock and
    // the battery would be white on near-white. `default` keeps the page below
    // the status bar and lets iOS fill that strip from `themeColor`, which
    // already tracks the two grounds.
    statusBarStyle: 'default',
  },
  // A home-screen launch is not a browser tab: there is no address bar to select
  // from, so a phone number or a date read as a tappable link is a mis-tap
  // waiting to happen on a screen that is mostly figures.
  formatDetection: { telephone: false, date: false, address: false },
}

export const viewport: Viewport = {
  // `cover` is what makes env(safe-area-inset-*) report real numbers; without it
  // iOS letterboxes the page inside the safe area and the tab bar floats above
  // the home indicator with a band of background under it.
  viewportFit: 'cover',
  // Left installable rather than pinned: the chrome around a standalone window
  // is painted from these, so they follow the page's own two grounds.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f9f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1411' },
  ],
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
