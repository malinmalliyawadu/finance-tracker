/**
 * The signed ticket, which is the whole of the app's authentication state.
 *
 * There is no session table and no second secret: a cookie is trusted because
 * it carries an HMAC this server can reproduce from APP_PASSWORD, and for no
 * other reason. So every way a ticket can be wrong is a way into the app, and
 * each of them is asserted here rather than reasoned about.
 *
 * No database. These are pure functions over strings, which is the point of
 * keeping them out of the modules that touch Postgres.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { clearAttempts, clientKey, takeAttempt } from '../src/lib/auth/rate-limit.ts'
import { safeNext } from '../src/lib/auth/session.ts'
import { readTicket, secretsMatch, signTicket } from '../src/lib/auth/ticket.ts'

const KEY = 'correct horse battery staple'
const HOUR = 3600

describe('signed tickets', () => {
  test('a ticket this key signed, for this purpose, reads back its value', async () => {
    const ticket = await signTicket({ key: KEY, purpose: 'session', ttlSeconds: HOUR })

    assert.equal(await readTicket({ key: KEY, purpose: 'session', ticket }), '')
  })

  test('the value survives the round trip intact', async () => {
    const challenge = 'q1w2e3r4-_ABC'
    const ticket = await signTicket({
      key: KEY,
      purpose: 'authenticate',
      value: challenge,
      ttlSeconds: HOUR,
    })

    assert.equal(await readTicket({ key: KEY, purpose: 'authenticate', ticket }), challenge)
  })

  test('an expired ticket is refused', async () => {
    const issued = 1_700_000_000_000
    const ticket = await signTicket({ key: KEY, purpose: 'session', ttlSeconds: 60, now: issued })

    assert.equal(
      await readTicket({ key: KEY, purpose: 'session', ticket, now: issued + 59_000 }),
      '',
      'still inside its minute',
    )
    assert.equal(
      await readTicket({ key: KEY, purpose: 'session', ticket, now: issued + 60_000 }),
      null,
      'the moment it lapses, not a second later',
    )
  })

  /**
   * The property the whole design rests on: the key is the password, so
   * changing the password signs every device out without anything having to
   * remember that it should.
   */
  test('a ticket signed with a different password is refused', async () => {
    const ticket = await signTicket({ key: KEY, purpose: 'session', ttlSeconds: HOUR })

    assert.equal(await readTicket({ key: 'the new password', purpose: 'session', ticket }), null)
  })

  test('an edited payload is refused', async () => {
    const ticket = await signTicket({
      key: KEY,
      purpose: 'authenticate',
      value: 'the-challenge-we-issued',
      ttlSeconds: HOUR,
    })
    const [, expiry, signature] = ticket.split('.') as [string, string, string]

    const forged = await signTicket({
      key: 'anything',
      purpose: 'authenticate',
      value: 'a-challenge-they-chose',
      ttlSeconds: HOUR,
    })
    const theirPayload = forged.split('.')[0]!

    const tampered = `${theirPayload}.${expiry}.${signature}`

    assert.equal(await readTicket({ key: KEY, purpose: 'authenticate', ticket: tampered }), null)
  })

  test('an edited expiry is refused', async () => {
    const issued = 1_700_000_000_000
    const ticket = await signTicket({ key: KEY, purpose: 'session', ttlSeconds: 60, now: issued })
    const [payload, , signature] = ticket.split('.') as [string, string, string]

    // The signature covers the expiry as well as the payload, so extending a
    // ticket's life is not something the holder can do.
    const extended = `${payload}.${issued + 10 * 365 * 24 * HOUR * 1000}.${signature}`

    assert.equal(
      await readTicket({ key: KEY, purpose: 'session', ticket: extended, now: issued + 120_000 }),
      null,
    )
  })

  /**
   * Both halves of both ceremonies are signed with the same key, because there
   * is only one key. The purpose string in the payload is therefore the only
   * thing stopping a registration challenge — which anyone signed in can
   * obtain — from being answered with a sign-in assertion.
   */
  test('a ticket issued for one purpose cannot be spent on another', async () => {
    const challenge = 'a-registration-challenge'
    const ticket = await signTicket({
      key: KEY,
      purpose: 'register',
      value: challenge,
      ttlSeconds: HOUR,
    })

    assert.equal(
      await readTicket({ key: KEY, purpose: 'register', ticket }),
      challenge,
      'genuine as what it was issued for',
    )
    assert.equal(
      await readTicket({ key: KEY, purpose: 'authenticate', ticket }),
      null,
      'and worthless as anything else',
    )
    assert.equal(await readTicket({ key: KEY, purpose: 'session', ticket }), null)
  })

  test('junk is refused rather than thrown at', async () => {
    const junk = [
      undefined,
      null,
      '',
      '.',
      '..',
      'not-a-ticket',
      'one.two',
      'one.two.three.four',
      'a.b.c',
      '!!!.1700000000000.???',
      // Well-formed base64url in every slot, signed by nobody.
      'c2Vzc2lvbjo.9999999999999.AAAA',
      // A signature of the right shape and length, still not ours.
      `c2Vzc2lvbjo.9999999999999.${'A'.repeat(43)}`,
    ]

    for (const ticket of junk) {
      assert.equal(
        await readTicket({ key: KEY, purpose: 'session', ticket }),
        null,
        `expected ${JSON.stringify(ticket)} to be refused`,
      )
    }
  })

  test('passwords are compared by value, whatever their length', async () => {
    assert.equal(await secretsMatch('hunter2', 'hunter2'), true)
    assert.equal(await secretsMatch('hunter2', 'hunter3'), false)
    assert.equal(await secretsMatch('hunter2', 'hunter2 '), false)
    assert.equal(await secretsMatch('', 'hunter2'), false)
  })
})

describe('where signing in sends you back to', () => {
  test('a path is kept', () => {
    assert.equal(safeNext('/transactions?period=2026-08-16'), '/transactions?period=2026-08-16')
  })

  /**
   * The login page is the one page a stranger can load, so an open redirect
   * here is an open redirect on the only door they can knock on. Browsers read
   * both of these as protocol-relative URLs pointing somewhere else entirely.
   */
  test('anything that leaves the site falls back to the dashboard', () => {
    for (const hostile of [
      '//evil.example/login',
      '/\\evil.example',
      'https://evil.example',
      'http://evil.example',
      'evil.example',
      '',
      null,
      undefined,
    ]) {
      assert.equal(safeNext(hostile), '/', `expected ${JSON.stringify(hostile)} to be discarded`)
    }
  })
})

describe('which client a password attempt is charged to', () => {
  /**
   * Proxies append to x-forwarded-for and clients can send one themselves, so
   * the leftmost entry is whatever the attacker wrote — a fresh identity, and a
   * fresh allowance, on every request. The rightmost is the one the nearest
   * proxy added.
   */
  test('the rightmost entry wins, because it is the one nobody chose', () => {
    assert.equal(clientKey(new Headers({ 'x-forwarded-for': '203.0.113.9' })), '203.0.113.9')
    assert.equal(
      clientKey(new Headers({ 'x-forwarded-for': '10.0.0.1, 172.16.0.2, 203.0.113.9' })),
      '203.0.113.9',
    )
  })

  test('a request with no header still lands somewhere countable', () => {
    assert.equal(clientKey(new Headers()), 'direct')
    assert.equal(clientKey(new Headers({ 'x-forwarded-for': '  ' })), 'direct')
  })

  test('eight attempts a minute, then a wait, then eight more', () => {
    const key = 'test-203.0.113.9'
    const start = 1_700_000_000_000
    clearAttempts(key)

    for (let i = 1; i <= 8; i += 1) {
      assert.equal(takeAttempt(key, start).allowed, true, `attempt ${i} should be allowed`)
    }

    const ninth = takeAttempt(key, start)
    assert.equal(ninth.allowed, false)
    assert.equal(ninth.allowed === false && ninth.retryAfterSeconds, 60)

    // The window slides rather than resetting on a schedule, so the allowance
    // comes back as the oldest attempt ages out and not a moment before.
    assert.equal(takeAttempt(key, start + 59_999).allowed, false)
    assert.equal(takeAttempt(key, start + 60_000).allowed, true)

    clearAttempts(key)
  })

  test('a correct password clears the record, so a near miss costs nothing later', () => {
    const key = 'test-198.51.100.4'
    const now = 1_700_000_000_000
    clearAttempts(key)

    for (let i = 0; i < 8; i += 1) takeAttempt(key, now)
    assert.equal(takeAttempt(key, now).allowed, false)

    clearAttempts(key)
    assert.equal(takeAttempt(key, now).allowed, true)

    clearAttempts(key)
  })
})
