import { NextResponse, type NextRequest } from 'next/server'

import { SESSION_COOKIE, authEnabled, requestOrigin, sessionIsValid } from './lib/auth/session.ts'

/**
 * The gate.
 *
 * One place every request passes through, rather than a check at the top of
 * each page. Page loads, form posts, server actions and the RSC payloads Next
 * fetches for client-side navigations are all requests, and a per-page check
 * covers only the first kind — with the added property that a page added next
 * year is gated because it exists, not because someone remembered.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (!authEnabled()) return NextResponse.next()

  const { pathname, search } = request.nextUrl

  // The login route itself, or the app has nowhere to send anyone.
  if (pathname === '/login') return NextResponse.next()

  if (await sessionIsValid(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next()
  }

  // A redirect answers a POST with a GET to the login page, which drops the
  // body and, worse, invites the browser to replay the submission once the
  // visitor signs in. 401 says what actually happened and changes nothing.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  // Where they were going, so signing in finishes the navigation they started
  // rather than dumping them on the dashboard. Sanitised on the way back out.
  const target =
    pathname === '/'
      ? '/login'
      : `/login?${new URLSearchParams({ next: `${pathname}${search}` })}`

  // Built from the forwarded headers rather than from `new URL(…, request.url)`:
  // behind the proxy this deploys behind, request.url carries the address the
  // container is bound to, so that form sends someone at
  // https://ledger.example/accounts to https://localhost:3000/login.
  return NextResponse.redirect(new URL(target, requestOrigin(request.headers).origin))
}

export const config = {
  /**
   * Everything except Next's own static output and the favicon. Static assets
   * carry no figures, and gating them means the login page loads unstyled.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
