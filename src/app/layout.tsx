import type { Metadata } from 'next'
import { Bricolage_Grotesque, IBM_Plex_Mono, Public_Sans } from 'next/font/google'

import { Rail } from '../components/rail.tsx'
import { getHealth } from '../lib/queries.ts'
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const health = await getHealth().catch(() => null)

  return (
    <html lang="en-NZ" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <div className="shell">
          <Rail health={health} />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  )
}
