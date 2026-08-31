import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { resetBusinessData, ensureTestUser } from '../dbFixtures.js'
import { invalidateSettingsCache, DEFAULT_IDLE_TIMEOUT_MINUTES } from '../../services/settingsService.js'

// Auto-logout on inactivity.
//
// The client-side countdown is a courtesy — it warns the user and signs them out tidily. What is
// tested here is the half that is actually a security control: the SESSION window itself. Someone
// who disables JavaScript, edits it, or replays a stolen cookie never runs the client timer, so
// the session has to expire on its own. These tests read the Set-Cookie header, because that (and
// the matching expiry connect-pg-simple writes to the session row) is the real enforcement.
describe('idle timeout — server-side session window', () => {
  let server: TestServer

  const ADMIN = 'idle-admin@currencydesk.local'
  const OPERATOR = 'idle-operator@currencydesk.local'
  const PASSWORD = 'test-password-123'

  /** Seconds until the session cookie in a response expires, from its Expires attribute. */
  function cookieLifetimeSeconds(setCookie: string | null): number {
    expect(setCookie, 'response should carry a session cookie').toBeTruthy()
    const m = /Expires=([^;]+)/i.exec(setCookie!)
    expect(m, `no Expires in: ${setCookie}`).toBeTruthy()
    return (new Date(m![1]).getTime() - Date.now()) / 1000
  }

  async function rawLogin(identifier: string) {
    return fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: PASSWORD }),
    })
  }

  beforeAll(async () => {
    await resetBusinessData(pool)
    await ensureTestUser(pool, ADMIN, PASSWORD, 'admin')
    await ensureTestUser(pool, OPERATOR, PASSWORD, 'user')
    server = await startTestServer()
  })

  beforeEach(async () => {
    // Back to the shipped default before each test, and drop the read-through cache so the change
    // is seen immediately rather than up to its TTL later.
    await pool.query("UPDATE app_settings SET value = '5' WHERE key = 'idle_timeout_minutes'")
    invalidateSettingsCache()
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  it('defaults to 5 minutes', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings`, {
      headers: { Cookie: await sessionCookieFor(ADMIN) },
    })
    expect(res.status).toBe(200)
    expect((await res.json()).idleTimeoutMinutes).toBe(DEFAULT_IDLE_TIMEOUT_MINUTES)
  })

  it('applies the idle window to the very first cookie of a session, at login', async () => {
    // The regression this guards: middleware runs before the route, so at middleware time a
    // logging-in request still looks anonymous and gets skipped. Without the explicit call in the
    // login handler, the first cookie of every session carried the default 30-day window and the
    // timeout only began applying from the user's second request onward.
    const res = await rawLogin(ADMIN)
    expect(res.status).toBe(200)
    const seconds = cookieLifetimeSeconds(res.headers.get('set-cookie'))
    expect(seconds).toBeGreaterThan(4 * 60)
    expect(seconds).toBeLessThanOrEqual(5 * 60 + 5)
  })

  it('slides the window forward on each request — this is what makes it an IDLE timeout', async () => {
    // rolling:true means the expiry is measured from the LAST request, not from login. Without
    // that this would be a fixed session lifetime, which would sign out a busy dealer mid-shift.
    const cookie = await sessionCookieFor(ADMIN)
    const first = await fetch(`${server.baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
    const firstLifetime = cookieLifetimeSeconds(first.headers.get('set-cookie'))

    await new Promise((r) => setTimeout(r, 1100))

    const second = await fetch(`${server.baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
    const secondLifetime = cookieLifetimeSeconds(second.headers.get('set-cookie'))

    // A second passed, so a FIXED window would now have ~1s less left. A sliding one is back to
    // full. Asserting it did not shrink is the meaningful check.
    expect(secondLifetime).toBeGreaterThan(firstLifetime - 0.5)
  })

  it('shortens live sessions when an admin lowers the setting', async () => {
    const cookie = await sessionCookieFor(ADMIN)

    const before = await fetch(`${server.baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
    expect(cookieLifetimeSeconds(before.headers.get('set-cookie'))).toBeGreaterThan(4 * 60)

    await pool.query("UPDATE app_settings SET value = '2' WHERE key = 'idle_timeout_minutes'")
    invalidateSettingsCache()

    // Applied per request, so an already-open session picks it up rather than keeping the old
    // window until the user signs out and back in.
    const after = await fetch(`${server.baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
    const seconds = cookieLifetimeSeconds(after.headers.get('set-cookie'))
    expect(seconds).toBeGreaterThan(60)
    expect(seconds).toBeLessThanOrEqual(2 * 60 + 5)
  })

  it('falls back to the default rather than to no timeout when the value is nonsense', async () => {
    // Fails CLOSED. A hand-edited or corrupted row must not be able to disable an access control;
    // "unparseable" has to mean "use the default", never "never expire".
    await pool.query("UPDATE app_settings SET value = 'not-a-number' WHERE key = 'idle_timeout_minutes'")
    invalidateSettingsCache()

    const res = await rawLogin(ADMIN)
    const seconds = cookieLifetimeSeconds(res.headers.get('set-cookie'))
    expect(seconds).toBeLessThanOrEqual(DEFAULT_IDLE_TIMEOUT_MINUTES * 60 + 5)
  })

  describe('who can change it', () => {
    it('lets an admin change it', async () => {
      const admin = new ApiClient(server.baseUrl)
      await admin.login(ADMIN, PASSWORD)
      const res = await admin.post('/api/settings', { idleTimeoutMinutes: 15 })
      // ApiClient only speaks POST; PATCH is exercised through fetch below. This asserts the route
      // exists and rejects the wrong verb rather than silently accepting it.
      expect([404, 405]).toContain(res.status)

      const patched = await fetch(`${server.baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: await sessionCookieFor(ADMIN) },
        body: JSON.stringify({ idleTimeoutMinutes: 15 }),
      })
      expect(patched.status).toBe(200)
      expect((await patched.json()).idleTimeoutMinutes).toBe(15)
    })

    it('refuses an operator', async () => {
      const res = await fetch(`${server.baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: await sessionCookieFor(OPERATOR) },
        body: JSON.stringify({ idleTimeoutMinutes: 60 }),
      })
      expect(res.status).toBe(403)
      invalidateSettingsCache()
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'idle_timeout_minutes'")
      expect(rows[0].value, 'the value must not have changed').toBe('5')
    })

    it('refuses an anonymous caller', async () => {
      const res = await fetch(`${server.baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idleTimeoutMinutes: 60 }),
      })
      expect(res.status).toBe(401)
    })

    it('rejects values outside the allowed range, and non-integers', async () => {
      const cookie = await sessionCookieFor(ADMIN)
      for (const bad of [0, -5, 999, 1.5, Number.NaN, 'abc']) {
        const res = await fetch(`${server.baseUrl}/api/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ idleTimeoutMinutes: bad }),
        })
        expect(res.status, `${bad} should be rejected`).toBe(400)
      }
    })
  })

  /** Logs in and returns just the session cookie pair. */
  async function sessionCookieFor(identifier: string): Promise<string> {
    const res = await rawLogin(identifier)
    expect(res.status).toBe(200)
    return (res.headers.get('set-cookie') || '').split(';')[0]
  }
})
