import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { truncateAndReseedTestDb, ensureTestUser, insertCustomer } from '../dbFixtures.js'

// Margin Ledger period close — scoped to Sale/Purchase only (trades have no edit/delete routes
// at all today, so the enforcement is entirely "reject a backdated post into a closed period").
// Driven over real HTTP so the route, the transaction and the admin gate all run as in production.
describe('period close', () => {
  let server: TestServer
  let admin: ApiClient
  let operator: ApiClient
  let customerId: string

  const ADMIN = 'periods-admin@currencydesk.local'
  const OPERATOR = 'periods-operator@currencydesk.local'
  const PASSWORD = 'test-password-123'

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    await ensureTestUser(pool, ADMIN, PASSWORD, 'admin')
    await ensureTestUser(pool, OPERATOR, PASSWORD, 'user')
    customerId = await insertCustomer(pool, 'Period Close Customer')
    server = await startTestServer()
    admin = new ApiClient(server.baseUrl)
    operator = new ApiClient(server.baseUrl)
    expect((await admin.login(ADMIN, PASSWORD)).status).toBe(200)
    expect((await operator.login(OPERATOR, PASSWORD)).status).toBe(200)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM periods')
    await pool.query('DELETE FROM journal_entries')
    await pool.query('DELETE FROM activity')
    await pool.query("UPDATE stock_positions SET available = 0, avg_cost = 0")
    await pool.query('UPDATE accounts SET receivable = 0, payable = 0')
  })

  const trade = (extra: Record<string, unknown>) => ({
    customerId, currency: 'AED', method: 'Credit', paidNow: 0,
    bankId: '', chqNo: '', chqBank: '', ...extra,
  })

  it("closing a period snapshots realized sales margin, not purchases or other months", async () => {
    // 1000 @ 78 purchased, then 500 sold @ 85 -> margin = 500 * (85 - 78) = 3,500. Both dated
    // inside August; a second sale dated in September must not be counted.
    expect((await admin.post('/api/trades/purchase', trade({ amount: 1000, rate: 78, txnDate: '2026-08-01' }))).status).toBe(200)
    expect((await admin.post('/api/trades/sale', trade({ amount: 500, rate: 85, txnDate: '2026-08-10' }))).status).toBe(200)
    expect((await admin.post('/api/trades/sale', trade({ amount: 100, rate: 90, txnDate: '2026-09-01' }))).status).toBe(200)

    const res = await admin.post('/api/periods/2026-08/close')
    expect(res.status).toBe(200)
    const period = res.json.periods.find((p: any) => p.id === '2026-08')
    expect(period).toBeTruthy()
    expect(period.closedMargin).toBe(3500)
    expect(period.reopenedAt).toBeUndefined()
  })

  it('blocks a new sale backdated into a closed period', async () => {
    expect((await admin.post('/api/trades/purchase', trade({ amount: 1000, rate: 78, txnDate: '2026-08-01' }))).status).toBe(200)
    expect((await admin.post('/api/periods/2026-08/close')).status).toBe(200)

    const res = await admin.post('/api/trades/sale', trade({ amount: 100, rate: 85, txnDate: '2026-08-20' }))
    expect(res.status).toBe(409)
    expect(res.json.error).toMatch(/August 2026 is closed/)

    // Nothing was written — the check runs before the stock lock or any insert.
    const { rows } = await pool.query("SELECT count(*) FROM activity WHERE type = 'sale'")
    expect(Number(rows[0].count)).toBe(0)
  })

  it('blocks a new purchase backdated into a closed period', async () => {
    expect((await admin.post('/api/periods/2026-08/close')).status).toBe(200)
    const res = await admin.post('/api/trades/purchase', trade({ amount: 100, rate: 78, txnDate: '2026-08-05' }))
    expect(res.status).toBe(409)
  })

  it('does not block a trade dated in a different, open month', async () => {
    expect((await admin.post('/api/periods/2026-08/close')).status).toBe(200)
    const res = await admin.post('/api/trades/purchase', trade({ amount: 100, rate: 78, txnDate: '2026-09-05' }))
    expect(res.status).toBe(200)
  })

  it('requires an explicit reopen before trading into the period again', async () => {
    expect((await admin.post('/api/periods/2026-08/close')).status).toBe(200)
    expect((await admin.post('/api/trades/purchase', trade({ amount: 100, rate: 78, txnDate: '2026-08-05' }))).status).toBe(409)

    const reopened = await admin.post('/api/periods/2026-08/reopen')
    expect(reopened.status).toBe(200)
    expect(reopened.json.periods.find((p: any) => p.id === '2026-08').reopenedAt).toBeTruthy()

    expect((await admin.post('/api/trades/purchase', trade({ amount: 100, rate: 78, txnDate: '2026-08-05' }))).status).toBe(200)
  })

  it('re-closing after a reopen overwrites the frozen figure with a fresh snapshot', async () => {
    expect((await admin.post('/api/trades/purchase', trade({ amount: 1000, rate: 78, txnDate: '2026-08-01' }))).status).toBe(200)
    expect((await admin.post('/api/trades/sale', trade({ amount: 500, rate: 85, txnDate: '2026-08-10' }))).status).toBe(200)

    const firstClose = await admin.post('/api/periods/2026-08/close')
    expect(firstClose.json.periods.find((p: any) => p.id === '2026-08').closedMargin).toBe(3500)

    expect((await admin.post('/api/periods/2026-08/reopen')).status).toBe(200)
    // A second sale, backdated into the now-reopened month, adds another 200 * (90 - 78) = 2,400.
    expect((await admin.post('/api/trades/sale', trade({ amount: 200, rate: 90, txnDate: '2026-08-15' }))).status).toBe(200)

    const secondClose = await admin.post('/api/periods/2026-08/close')
    expect(secondClose.status).toBe(200)
    const period = secondClose.json.periods.find((p: any) => p.id === '2026-08')
    expect(period.closedMargin).toBe(5900)
    expect(period.reopenedAt).toBeUndefined()
  })

  it('refuses to close an already-closed period', async () => {
    expect((await admin.post('/api/periods/2026-08/close')).status).toBe(200)
    const res = await admin.post('/api/periods/2026-08/close')
    expect(res.status).toBe(409)
    expect(res.json.error).toMatch(/already closed/)
  })

  it('refuses to reopen a period that was never closed', async () => {
    const res = await admin.post('/api/periods/2026-08/reopen')
    expect(res.status).toBe(400)
    expect(res.json.error).toMatch(/never been closed/)
  })

  it('refuses to reopen a period that is already open', async () => {
    expect((await admin.post('/api/periods/2026-08/close')).status).toBe(200)
    expect((await admin.post('/api/periods/2026-08/reopen')).status).toBe(200)
    const res = await admin.post('/api/periods/2026-08/reopen')
    expect(res.status).toBe(409)
    expect(res.json.error).toMatch(/already open/)
  })

  it('rejects a malformed period id', async () => {
    const res = await admin.post('/api/periods/not-a-period/close')
    expect(res.status).toBe(400)
  })

  it('is Admin-only — an Operator cannot close or reopen', async () => {
    expect((await operator.post('/api/periods/2026-08/close')).status).toBe(403)
    expect((await admin.post('/api/periods/2026-08/close')).status).toBe(200)
    expect((await operator.post('/api/periods/2026-08/reopen')).status).toBe(403)
  })

  it("omits periods from an Operator's own snapshot, same gating as activity.margin", async () => {
    expect((await admin.post('/api/periods/2026-08/close')).status).toBe(200)
    const state = await operator.get('/api/state')
    expect(state.json.periods).toEqual([])
  })
})
