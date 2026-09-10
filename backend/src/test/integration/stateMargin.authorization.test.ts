import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { truncateAndReseedTestDb, ensureTestUser, insertCustomer } from '../dbFixtures.js'

// Per-deal cost basis and realised margin are Admin-only in the UI (/income-statement sits behind
// RequireAdmin, and Stock.tsx swaps the movement-by-movement ledger for a "restricted to Admin"
// card for Operators) — but the snapshot served by GET /api/state carried both fields for every
// role, so that boundary was decorative.
//
// These tests assert the JSON that actually crossed the wire rather than the shape of an
// in-process object: an `undefined` property still exists as a key on a JS object but vanishes
// through JSON.stringify, and the wire is what leaked.
describe('cost/margin authorization on the state snapshot', () => {
  let server: TestServer
  let admin: ApiClient
  let operator: ApiClient
  let customerId: string

  const ADMIN = 'margin-admin@currencydesk.local'
  const OPERATOR = 'margin-operator@currencydesk.local'
  const PASSWORD = 'test-password-123'

  // A purchase, then a sale at a higher rate, so there is a real non-zero margin to leak.
  const BUY_RATE = 70
  const SELL_RATE = 80
  const QTY = 1000
  const EXPECTED_COST = QTY * BUY_RATE // 70,000
  const EXPECTED_MARGIN = QTY * (SELL_RATE - BUY_RATE) // 10,000

  const trade = (extra: Record<string, unknown>) => ({
    customerId,
    currency: 'AED',
    method: 'Credit',
    paidNow: 0,
    bankId: '',
    chqNo: '',
    chqBank: '',
    ...extra,
  })

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    await ensureTestUser(pool, ADMIN, PASSWORD, 'admin')
    await ensureTestUser(pool, OPERATOR, PASSWORD, 'user')
    customerId = await insertCustomer(pool, 'Margin Test Customer')

    server = await startTestServer()

    admin = new ApiClient(server.baseUrl)
    expect((await admin.login(ADMIN, PASSWORD)).status).toBe(200)

    operator = new ApiClient(server.baseUrl)
    expect((await operator.login(OPERATOR, PASSWORD)).status).toBe(200)

    expect((await admin.post('/api/trades/purchase', trade({ amount: QTY, rate: BUY_RATE }))).status).toBe(200)
    expect((await admin.post('/api/trades/sale', trade({ amount: QTY, rate: SELL_RATE }))).status).toBe(200)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  /** Round-trips through JSON so the assertion sees exactly the keys that crossed the wire. */
  const wireKeys = (row: unknown): string[] => Object.keys(JSON.parse(JSON.stringify(row)) as object)
  const saleRow = (snapshot: any) => snapshot.activity.find((a: any) => a.type === 'sale')

  it('serves cost and margin to an Admin, with the real figures', async () => {
    const res = await admin.get('/api/state')
    expect(res.status).toBe(200)

    const sale = saleRow(res.json)
    expect(sale, 'the sale row should be in the snapshot').toBeTruthy()
    expect(wireKeys(sale)).toContain('cost')
    expect(wireKeys(sale)).toContain('margin')
    expect(sale.cost).toBeCloseTo(EXPECTED_COST, 2)
    expect(sale.margin).toBeCloseTo(EXPECTED_MARGIN, 2)
  })

  it('omits cost and margin from every activity row for an Operator', async () => {
    const res = await operator.get('/api/state')
    expect(res.status).toBe(200)

    const sale = saleRow(res.json)
    expect(sale, 'the Operator still sees the sale itself').toBeTruthy()
    // ABSENT, not zeroed: a 0 would read as "this sale made nothing", which is a different and
    // wrong claim than "you are not shown this".
    expect(wireKeys(sale)).not.toContain('cost')
    expect(wireKeys(sale)).not.toContain('margin')

    for (const row of res.json.activity) {
      expect(wireKeys(row)).not.toContain('cost')
      expect(wireKeys(row)).not.toContain('margin')
    }
  })

  it('still gives the Operator everything they need to work the desk', async () => {
    const res = await operator.get('/api/state')
    const sale = saleRow(res.json)

    // Stripping margin must not strip the trade. Amount, rate and PKR value drive the
    // Transactions list and the customer statement, both open to every role.
    expect(sale.amount).toBe(QTY)
    expect(sale.rate).toBeCloseTo(SELL_RATE, 2)
    expect(sale.pkrValue).toBeCloseTo(QTY * SELL_RATE, 2)
    // Current weighted-average cost stays on `stocks` for every role deliberately — an Operator
    // cannot price a sale without it. See SnapshotView for what this fix does and does not claim.
    expect(res.json.stocks).toHaveProperty('AED')
  })

  it('filters a mutation response too, not only GET /api/state', async () => {
    // Every mutating endpoint returns the same full snapshot, so an Operator posting their own
    // trade would otherwise get the Admin-only figures straight back in the response body — the
    // exact hole that filtering only the GET would have left wide open. Trades are requireAuth,
    // so this is a request the Operator is genuinely allowed to make.
    const res = await operator.post('/api/trades/purchase', trade({ amount: 500, rate: BUY_RATE }))
    expect(res.status).toBe(200)

    const sale = saleRow(res.json)
    expect(sale, 'the earlier sale is still in the returned snapshot').toBeTruthy()
    expect(wireKeys(sale)).not.toContain('cost')
    expect(wireKeys(sale)).not.toContain('margin')
  })

  it('gives an Admin the figures back on their own mutation response', async () => {
    const res = await admin.post('/api/trades/purchase', trade({ amount: 500, rate: BUY_RATE }))
    expect(res.status).toBe(200)

    const sale = saleRow(res.json)
    expect(wireKeys(sale)).toContain('margin')
    expect(sale.margin).toBeCloseTo(EXPECTED_MARGIN, 2)
  })
})
