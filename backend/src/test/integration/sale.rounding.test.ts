import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { truncateAndReseedTestDb, ensureTestUser, insertCustomer } from '../dbFixtures.js'

// AUDIT.md §3 #4, fixed 2026-09-21: the three figures of a sale must sum.
//
// This is the client's OWN sequence from his ledger, on a clean desk — three billion Toman at 797,
// five billion at 787, then a sale of three billion at 788 — and that exact sequence matters. It is
// what left the average cost at 0.001264669448, which makes the sale's cost 3,794,008.344 and its
// profit 13,098.2589...: the pair that independent rounding stored as 3,794,008.34 and 13,098.25,
// one paisa short of the 3,807,106.60 the customer owes. A test with any extra purchase in front of
// it shifts the average, lands the cost on a different paisa, and quietly stops reproducing the
// fault — trades.currency.test.ts's sale is exactly such a test, which is why this one is separate.
describe('a sale\'s cost and margin sum to what the customer owes, to the paisa', () => {
  let server: TestServer
  let client: ApiClient
  let supplierId: string
  let buyerId: string

  const EMAIL = 'sale-rounding@currencydesk.local'
  const PASSWORD = 'test-password-123'

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    await ensureTestUser(pool, EMAIL, PASSWORD, 'admin')
    supplierId = await insertCustomer(pool, 'Rounding Supplier')
    buyerId = await insertCustomer(pool, 'Rounding Buyer')
    server = await startTestServer()
    client = new ApiClient(server.baseUrl)
    expect((await client.login(EMAIL, PASSWORD)).status).toBe(200)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  const deal = (customerId: string, amount: number, rate: number) => ({
    customerId, currency: 'TMN', amount, rate, method: 'Credit', paidNow: 0, bankId: '', chqNo: '', chqBank: '', txnDate: '2026-09-15',
  })

  const paisa = (v: unknown) => Math.round(Number(v) * 100)

  it("books the client's own three deals and the sale's figures sum exactly", async () => {
    expect((await client.post('/api/trades/purchase', deal(supplierId, 3_000_000_000, 797))).status).toBe(200)
    expect((await client.post('/api/trades/purchase', deal(supplierId, 5_000_000_000, 787))).status).toBe(200)
    // Pins the precondition: it is THIS average cost that makes the fault appear.
    const { rows: stock } = await pool.query("SELECT avg_cost FROM stock_positions WHERE code = 'TMN'")
    expect(Number(stock[0].avg_cost)).toBeCloseTo(0.001264669448, 12)

    expect((await client.post('/api/trades/sale', deal(buyerId, 3_000_000_000, 788))).status).toBe(200)

    const { rows } = await pool.query("SELECT id, pkr_value, cost, margin FROM activity WHERE type = 'sale'")
    expect(rows).toHaveLength(1)
    const sale = rows[0]

    // The customer owes 3,807,106.60 — the client's ledger prints 3,807,107 — and the stock cost
    // 3,794,008.34. Neither figure moved; the margin took the paisa: 13,098.26, not 13,098.25.
    expect(Number(sale.pkr_value)).toBe(3807106.6)
    expect(Number(sale.cost)).toBe(3794008.34)
    expect(Number(sale.margin)).toBe(13098.26)
    expect(paisa(sale.cost) + paisa(sale.margin), 'cost + margin must equal pkr_value to the paisa').toBe(paisa(sale.pkr_value))
  })

  it("posts a voucher that debits the customer exactly the balance the sale moved", async () => {
    // The customer's receivable rose by pkr_value. If the voucher debited cost + margin instead and
    // those fell a paisa short, the journal and the stored balance drifted apart — which is the
    // 0.01 that `npm run reconcile` reported against this customer.
    const { rows: act } = await pool.query("SELECT id, pkr_value FROM activity WHERE type = 'sale'")
    const { rows: cust } = await pool.query('SELECT receivable FROM accounts WHERE id = $1', [buyerId])
    expect(Number(cust[0].receivable)).toBe(3807106.6)

    const { rows: legs } = await pool.query(
      'SELECT COALESCE(SUM(amount), 0)::float8 AS debited FROM journal_entries WHERE activity_id = $1 AND debit_account = $2',
      [act[0].id, buyerId],
    )
    expect(paisa(legs[0].debited), 'voucher debit to the customer').toBe(paisa(cust[0].receivable))
    expect(paisa(legs[0].debited)).toBe(paisa(act[0].pkr_value))
  })
})
