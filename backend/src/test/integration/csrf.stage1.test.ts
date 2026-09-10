import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { truncateAndReseedTestDb, ensureTestUser, insertCustomer } from '../dbFixtures.js'

// Stage 1 of the three-stage CSRF rollout (see middleware/csrf.ts):
//   the backend issues a token, validates it WHEN SENT, and does not yet require it.
//
// The single most important assertion in this file is the "no token is still accepted" one. If
// that ever starts failing while CSRF_ENFORCE is unset, stage 1 has silently become stage 3 and
// every user on a cached pre-stage-2 bundle is locked out of the desk.
describe('CSRF stage 1 — issue and validate, do not yet require', () => {
  let server: TestServer
  let customerId: string

  const EMAIL = 'csrf-stage1@currencydesk.local'
  const PASSWORD = 'test-password-123'

  const trade = () => ({
    customerId,
    currency: 'AED',
    amount: 100,
    rate: 70,
    method: 'Credit',
    paidNow: 0,
    bankId: '',
    chqNo: '',
    chqBank: '',
  })

  /** Raw fetch so a test can control the CSRF header precisely, including omitting it. */
  async function post(cookie: string, path: string, body: unknown, token?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Cookie: cookie }
    if (token !== undefined) headers['X-CSRF-Token'] = token
    const res = await fetch(`${server.baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
    return { status: res.status, json: (await res.json().catch(() => null)) as any }
  }

  async function login(): Promise<{ cookie: string; token: string }> {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: EMAIL, password: PASSWORD }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { csrfToken: string }
    const cookie = (res.headers.get('set-cookie') || '').split(';')[0]
    return { cookie, token: body.csrfToken }
  }

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    await ensureTestUser(pool, EMAIL, PASSWORD, 'admin')
    customerId = await insertCustomer(pool, 'CSRF Test Customer')
    server = await startTestServer()
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  it('returns a CSRF token from login', async () => {
    const { token } = await login()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns the SAME token from /me, so a returning user who never re-logs in can get one', async () => {
    // This is what stops stage 3 signing out every session created before the middleware shipped:
    // /me is the only call a returning user makes on boot, so it has to hand the token over.
    const { cookie, token } = await login()
    const res = await fetch(`${server.baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { csrfToken: string }
    expect(body.csrfToken).toBe(token)
  })

  it('issues DIFFERENT tokens to different sessions', async () => {
    const a = await login()
    const b = await login()
    expect(a.token).not.toBe(b.token)
  })

  it('accepts a mutating request carrying the correct token', async () => {
    const { cookie, token } = await login()
    const res = await post(cookie, '/api/trades/purchase', trade(), token)
    expect(res.status).toBe(200)
  })

  it('STILL ACCEPTS a mutating request with no token at all — this is what makes it stage 1', async () => {
    // The whole point of the staged rollout. If this flips to 403 before the frontend ships the
    // header, every user on a cached bundle loses the ability to trade.
    const { cookie } = await login()
    const res = await post(cookie, '/api/trades/purchase', trade())
    expect(res.status).toBe(200)
  })

  it('REJECTS a mutating request carrying a wrong token, even at stage 1', async () => {
    // Being strict here carries no rollout risk: nothing legitimate sends this header yet, so a
    // mismatch is either a bug or an attack. Neither should be waved through.
    const { cookie } = await login()
    const res = await post(cookie, '/api/trades/purchase', trade(), 'f'.repeat(64))
    expect(res.status).toBe(403)
    expect(res.json.error).toMatch(/security token/i)
    // The client keys its refresh-and-retry on this code, not on the message text.
    expect(res.json.code).toBe('CSRF_TOKEN')
  })

  it('rejects a token of the wrong length without a 500 from timingSafeEqual', async () => {
    // crypto.timingSafeEqual throws on a length mismatch; an unguarded compare would turn a
    // malformed header into a 500 (and leak length through the status code).
    const { cookie } = await login()
    const res = await post(cookie, '/api/trades/purchase', trade(), 'short')
    expect(res.status).toBe(403)
  })

  it('never requires a token on a GET', async () => {
    const { cookie } = await login()
    const res = await fetch(`${server.baseUrl}/api/state`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
  })

  it('exempts login itself, which has no session to bind a token to', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: EMAIL, password: PASSWORD }),
    })
    expect(res.status).toBe(200)
  })

  it('leaves an unauthenticated mutating request as a 401, not a confusing 403', async () => {
    // No session means no token could have been issued, so rejecting on CSRF grounds would be
    // misleading — requireAuth should be the thing that answers.
    const res = await post('', '/api/trades/purchase', trade())
    expect(res.status).toBe(401)
  })

  it('binds the token to its own session — another session\'s token is not accepted', async () => {
    const a = await login()
    const b = await login()
    const res = await post(a.cookie, '/api/trades/purchase', trade(), b.token)
    expect(res.status).toBe(403)
  })

  // -------------------------------------------------------------------------
  // Durable record of untokened requests — the stage-3 gate (migration 013)
  // -------------------------------------------------------------------------
  // Vercel's runtime logs are deployment-scoped and short-lived, so "the log is quiet" cannot
  // distinguish no untokened requests from a fresh deployment or an expired entry. Acting on the
  // wrong one locks out every user on a cached bundle. These tests cover the durable signal the
  // stage-3 decision is actually made from.
  describe('durable missing-token record', () => {
    const countRows = async () => {
      const { rows } = await pool.query<{ total: number; n: number }>(
        'SELECT COALESCE(SUM(count),0)::int AS total, COUNT(*)::int AS n FROM csrf_missing_token',
      )
      return rows[0]
    }

    it('records a mutating request that arrived without a token', async () => {
      await pool.query('TRUNCATE csrf_missing_token')
      const { cookie } = await login()

      expect((await post(cookie, '/api/trades/purchase', trade())).status).toBe(200)

      const { rows } = await pool.query<{ method: string; path: string; count: number; user_id: string }>(
        'SELECT method, path, count, user_id FROM csrf_missing_token',
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].method).toBe('POST')
      expect(rows[0].path).toBe('/api/trades/purchase')
      expect(rows[0].count).toBe(1)
      expect(rows[0].user_id).toBeTruthy()
    })

    it('increments an existing row rather than adding one per request', async () => {
      // Bucketed by hour on purpose: a stuck client retrying a failed action must not be able to
      // grow this table without bound.
      await pool.query('TRUNCATE csrf_missing_token')
      const { cookie } = await login()

      for (let i = 0; i < 3; i++) {
        expect((await post(cookie, '/api/trades/purchase', trade())).status).toBe(200)
      }

      const { total, n } = await countRows()
      expect(n, 'one bucketed row, not three').toBe(1)
      expect(total, 'but the real volume is still counted').toBe(3)
    })

    it('records NOTHING when the request carries a valid token — the gate must stay clean', async () => {
      // The load-bearing assertion. If a correctly-behaving request left a row here, the gate
      // would never go green and stage 3 could never be switched on.
      await pool.query('TRUNCATE csrf_missing_token')
      const { cookie, token } = await login()

      expect((await post(cookie, '/api/trades/purchase', trade(), token)).status).toBe(200)

      expect((await countRows()).n).toBe(0)
    })

    it('records nothing for a safe method or an unauthenticated request', async () => {
      await pool.query('TRUNCATE csrf_missing_token')
      const { cookie } = await login()

      await fetch(`${server.baseUrl}/api/state`, { headers: { Cookie: cookie } })
      await post('', '/api/trades/purchase', trade()) // no session at all

      expect((await countRows()).n).toBe(0)
    })
  })
})
