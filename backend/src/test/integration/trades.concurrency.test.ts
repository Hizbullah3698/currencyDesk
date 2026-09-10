import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { truncateAndReseedTestDb, ensureTestUser, insertCustomer } from '../dbFixtures.js'

describe('concurrent sale requests against shared stock', () => {
  let server: TestServer
  let client: ApiClient
  let customerId: string

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    await ensureTestUser(pool, 'concurrency-trades@currencydesk.local', 'test-password-123', 'admin')
    customerId = await insertCustomer(pool, 'Concurrency Test Customer')
    await pool.query("UPDATE stock_positions SET available = 100, avg_cost = 78 WHERE code = 'AED'")

    server = await startTestServer()
    client = new ApiClient(server.baseUrl)
    const login = await client.login('concurrency-trades@currencydesk.local', 'test-password-123')
    expect(login.status).toBe(200)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  it('lets exactly one of two concurrent oversell attempts succeed, rejecting the other against the true remaining balance', async () => {
    // Two independent clients sharing one session cookie, mirroring two browser tabs of the same
    // logged-in user — the mechanism under test (lockStock()'s FOR UPDATE + a post-lock
    // re-validation) is identity-agnostic, exactly as verified by hand in Phase 2.
    const clientA = client.withSameSession()
    const clientB = client.withSameSession()

    const saleInput = {
      customerId,
      currency: 'AED',
      amount: 100,
      rate: 80,
      method: 'Credit',
      paidNow: 0,
      bankId: '',
      chqNo: '',
      chqBank: '',
    }

    // Dispatched with no await between them — sequential fetches (or shelled-out curl processes)
    // can arrive far enough apart in real time to never actually collide; Promise.all with no
    // intervening await is what reliably forces true concurrent execution (see CLAUDE.md's
    // documented lesson from forcing this same race by hand in Phase 2).
    const [resA, resB] = await Promise.all([clientA.post('/api/trades/sale', saleInput), clientB.post('/api/trades/sale', saleInput)])

    const statuses = [resA.status, resB.status].sort()
    expect(statuses).toEqual([200, 400])

    const failed = resA.status === 400 ? resA : resB
    expect(failed.json.error).toMatch(/Cannot sell more than available AED stock \(0 AED\)/)

    const { rows } = await pool.query('SELECT available FROM stock_positions WHERE code = $1', ['AED'])
    expect(rows[0].available).toBe(0)

    const { rows: saleRows } = await pool.query("SELECT count(*) FROM activity WHERE type = 'sale'")
    expect(Number(saleRows[0].count)).toBe(1)
  })
})
