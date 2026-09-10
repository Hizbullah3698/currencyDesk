import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { resetBusinessData, ensureTestUser, insertCustomer } from '../dbFixtures.js'
import { deskToday } from '../../config/deskTime.js'

// IRR is quoted the other way round from AED — the dealer types "IRR per 1 PKR" (~4,952.53) and
// the value is DIVIDED, not multiplied (see packages/engine/src/currencies.ts). Everything here
// asserts the ACTUAL numbers Postgres ends up holding, because the failure mode this guards
// against is not an error response: multiplying instead of dividing returns a perfectly happy
// 200 while booking the position at ~24.5 million times its real cost.
describe('multi-currency trades (IRR divide-quote, txnDate)', () => {
  let server: TestServer
  let client: ApiClient
  let customerId: string

  // 1,000,000 IRR at 4,952.53 IRR per PKR.
  //   unit cost = 1 / 4952.53      = 0.00020191699999798083 PKR per IRR
  //   pkr value = 1e6 / 4952.53    = 201.91699999798084 -> 201.92 in activity.pkr_value (18,2)
  const RATE_1 = 4952.53
  const QTY_1 = 1_000_000
  const UNIT_1 = 1 / RATE_1

  // A second buy at a stronger rial: 500,000 IRR at 4,000 IRR per PKR.
  //   unit cost = 1 / 4000 = 0.00025 PKR per IRR, pkr value = 125.00
  const RATE_2 = 4000
  const QTY_2 = 500_000
  const UNIT_2 = 1 / RATE_2

  beforeAll(async () => {
    await resetBusinessData(pool)
    await ensureTestUser(pool, 'currency-trades@currencydesk.local', 'test-password-123', 'admin')
    customerId = await insertCustomer(pool, 'Currency Test Supplier')

    server = await startTestServer()
    client = new ApiClient(server.baseUrl)
    const login = await client.login('currency-trades@currencydesk.local', 'test-password-123')
    expect(login.status).toBe(200)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  const purchaseBody = (amount: number, rate: number, extra: Record<string, unknown> = {}) => ({
    customerId,
    currency: 'IRR',
    amount,
    rate,
    method: 'Credit',
    paidNow: 0,
    bankId: '',
    chqNo: '',
    chqBank: '',
    ...extra,
  })

  it('divides a divide-quoted rate when valuing the purchase and when costing the position', async () => {
    const res = await client.post('/api/trades/purchase', purchaseBody(QTY_1, RATE_1, { txnDate: '2026-08-14' }))
    expect(res.status).toBe(200)

    const { rows } = await pool.query("SELECT * FROM activity WHERE type = 'purchase' AND currency = 'IRR'")
    expect(rows).toHaveLength(1)
    const row = rows[0]

    // Stored PKR value: 201.92, not 4,952,530,000.
    expect(Number(row.pkr_value)).toBeCloseTo(201.92, 2)
    expect(Number(row.outstanding)).toBeCloseTo(201.92, 2)
    // The rate is stored EXACTLY as the dealer typed it, in IRR's own quote convention — engine's
    // unitPkr() re-derives PKR-per-unit from it on every replay, so storing an already-converted
    // value here would double-convert every report that reads it back.
    expect(Number(row.rate)).toBe(RATE_1)
    expect(Number(row.amount)).toBe(QTY_1)

    const { rows: stock } = await pool.query("SELECT available, avg_cost FROM stock_positions WHERE code = 'IRR'")
    expect(Number(stock[0].available)).toBe(QTY_1)
    // 0.000201917, held to 12 decimals by migration 012's widened column. numeric(18,6) would
    // have rounded this to 0.000202 (a 0.041% error that compounds on every re-weight).
    expect(Number(stock[0].avg_cost)).toBeCloseTo(UNIT_1, 12)
    // The whole position's cost basis in PKR — the number the Balance Sheet carries.
    expect(Number(stock[0].available) * Number(stock[0].avg_cost)).toBeCloseTo(201.917, 3)

    // The customer is owed the PKR value, not the raw rate x amount.
    const { rows: cust } = await pool.query('SELECT payable FROM accounts WHERE id = $1', [customerId])
    expect(Number(cust[0].payable)).toBeCloseTo(201.92, 2)
  })

  it('re-weights the average cost against the stored PKR-per-unit, not the typed quote rate', async () => {
    const res = await client.post('/api/trades/purchase', purchaseBody(QTY_2, RATE_2))
    expect(res.status).toBe(200)

    const { rows: stock } = await pool.query("SELECT available, avg_cost FROM stock_positions WHERE code = 'IRR'")
    expect(Number(stock[0].available)).toBe(QTY_1 + QTY_2)

    // (1,000,000 x 0.000201917 + 500,000 x 0.00025) / 1,500,000 = 326.917 / 1,500,000
    //                                                           = 0.000217944666...
    const expectedAvg = (QTY_1 * UNIT_1 + QTY_2 * UNIT_2) / (QTY_1 + QTY_2)
    expect(expectedAvg).toBeCloseTo(0.000217944667, 11)
    expect(Number(stock[0].avg_cost)).toBeCloseTo(expectedAvg, 11)
    // Total cost basis = 201.917 + 125.00.
    expect(Number(stock[0].available) * Number(stock[0].avg_cost)).toBeCloseTo(326.917, 3)

    const { rows } = await pool.query("SELECT pkr_value FROM activity WHERE type = 'purchase' AND rate = $1", [RATE_2])
    expect(Number(rows[0].pkr_value)).toBeCloseTo(125.0, 2)
  })

  it('stores and returns the supplied txnDate as a plain YYYY-MM-DD string, defaulting to today when omitted', async () => {
    // The first purchase carried txnDate 2026-08-14; the second omitted it entirely.
    const { rows } = await pool.query("SELECT rate, txn_date, created_at FROM activity WHERE type = 'purchase' ORDER BY created_at")
    expect(rows).toHaveLength(2)

    // The DATE type parser in db/pool.ts hands back the literal text Postgres holds — the same
    // mechanism cheques.due_date already relies on, so no Date object and no timezone shift.
    expect(rows[0].txn_date).toBe('2026-08-14')
    expect(typeof rows[0].txn_date).toBe('string')

    // Omitted -> the desk's own calendar day, decided by the server in the desk's timezone rather
    // than left to the column's CURRENT_DATE default (the database's day, UTC on Neon). See
    // config/deskTime.ts and integration/deskDate.test.ts for the 02:30-local case.
    expect(rows[1].txn_date).toBe(deskToday())

    // And it comes back through the API snapshot as `txnDate`, not just in the table — the
    // mutation response IS the refetch in this app, so this is what the frontend actually reads.
    const snap = await client.post('/api/trades/purchase', purchaseBody(1000, RATE_2, { txnDate: '2026-08-01' }))
    expect(snap.status).toBe(200)
    const backdated = (snap.json.activity as Array<{ rate?: number; txnDate?: string }>).find((a) => a.txnDate === '2026-08-01')
    expect(backdated).toBeDefined()
    const everyRowHasIt = (snap.json.activity as Array<{ txnDate?: string }>).every((a) => typeof a.txnDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.txnDate!))
    expect(everyRowHasIt).toBe(true)
  })

  it('rejects an unknown currency with a clean 400 rather than silently creating a position for it', async () => {
    const res = await client.post('/api/trades/purchase', { ...purchaseBody(100, 280), currency: 'CHF' })
    expect(res.status).toBe(400)
    // CHF, not USD — USD became a traded currency in migration 014, so it stopped being a valid
    // example of something the desk rejects. This test correctly failed when that changed.
    expect(res.json.error).toMatch(/Unknown currency "CHF"/)

    const { rows } = await pool.query("SELECT code FROM stock_positions WHERE code = 'CHF'")
    expect(rows).toHaveLength(0)
  })

  it('rejects a malformed, impossible, future, or pre-2000 txnDate with a clean 400', async () => {
    const bad: Array<[unknown, RegExp]> = [
      ['14-08-2026', /YYYY-MM-DD/],
      ['2026-8-14', /YYYY-MM-DD/],
      ['2026-08-14T00:00:00Z', /YYYY-MM-DD/],
      ['not-a-date', /YYYY-MM-DD/],
      ['2026-02-30', /not a real calendar date/],
      ['2026-13-01', /not a real calendar date/],
      ['1999-12-31', /cannot be before 2000-01-01/],
      ['2099-01-01', /cannot be in the future/],
    ]
    for (const [value, expected] of bad) {
      const res = await client.post('/api/trades/purchase', purchaseBody(1000, RATE_2, { txnDate: value }))
      expect(res.status, `txnDate ${JSON.stringify(value)} should be rejected`).toBe(400)
      expect(res.json.error).toMatch(expected)
    }

    // A blank string is not an error — it means "not supplied", same as omitting the field.
    const blank = await client.post('/api/trades/purchase', purchaseBody(1000, RATE_2, { txnDate: '' }))
    expect(blank.status).toBe(200)
  })

  it('accepts a txnDate on a settlement on exactly the same terms', async () => {
    const settleCustomer = await insertCustomer(pool, 'Settlement Date Customer', { receivable: 5000 })
    const ok = await client.post('/api/settlements/receive', {
      customerId: settleCustomer,
      amount: 1000,
      method: 'Cash',
      bankId: '',
      chqNo: '',
      chqBank: '',
      txnDate: '2026-07-04',
    })
    expect(ok.status).toBe(200)

    const { rows } = await pool.query("SELECT txn_date FROM activity WHERE type = 'receive' AND customer_id = $1", [settleCustomer])
    expect(rows[0].txn_date).toBe('2026-07-04')

    const bad = await client.post('/api/settlements/receive', {
      customerId: settleCustomer,
      amount: 1000,
      method: 'Cash',
      bankId: '',
      chqNo: '',
      chqBank: '',
      txnDate: '2026-02-30',
    })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toMatch(/not a real calendar date/)
  })

  it('values an IRR sale by dividing the sale rate while costing it at the stored PKR-per-unit', async () => {
    // Expectations are derived from whatever the position actually holds at this point rather
    // than from a hard-coded figure, because the two sides of the assertion are the point: the
    // sale RATE must be divided (quote convention) while avg_cost must be multiplied (already
    // canonical). Getting either one backwards changes the result by ~7 orders of magnitude.
    const { rows: before } = await pool.query("SELECT available, avg_cost FROM stock_positions WHERE code = 'IRR'")
    const avgCost = Number(before[0].avg_cost)
    const qty = 500_000
    const sellRate = 4900

    const res = await client.post('/api/trades/sale', {
      ...purchaseBody(qty, sellRate),
      customerId,
    })
    expect(res.status).toBe(200)

    const { rows } = await pool.query("SELECT amount, rate, pkr_value, cost, margin FROM activity WHERE type = 'sale' AND currency = 'IRR'")
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].rate)).toBe(sellRate)
    expect(Number(rows[0].pkr_value)).toBeCloseTo(qty / sellRate, 2)
    expect(Number(rows[0].cost)).toBeCloseTo(qty * avgCost, 2)
    expect(Number(rows[0].margin)).toBeCloseTo(qty / sellRate - qty * avgCost, 2)
    // ~102.04 PKR of proceeds against ~109 PKR of cost — three-figure PKR numbers either way,
    // not the billions a mis-multiplied rate would produce.
    expect(Number(rows[0].pkr_value)).toBeLessThan(1000)
    expect(Number(rows[0].cost)).toBeLessThan(1000)

    // A sale moves quantity only — the weighted-average cost is untouched.
    const { rows: after } = await pool.query("SELECT available, avg_cost FROM stock_positions WHERE code = 'IRR'")
    expect(Number(after[0].available)).toBe(Number(before[0].available) - qty)
    expect(Number(after[0].avg_cost)).toBe(avgCost)
  })

  it('still trades AED exactly as it did before the multi-currency change', async () => {
    // The regression that matters most: a multiply-quoted currency must be untouched by all of
    // the above. 100 AED at 77 is 7,700 PKR and an avg cost of 77 PKR per AED, full stop.
    const res = await client.post('/api/trades/purchase', { ...purchaseBody(100, 77), currency: 'AED' })
    expect(res.status).toBe(200)

    const { rows } = await pool.query("SELECT pkr_value FROM activity WHERE currency = 'AED' AND type = 'purchase'")
    expect(Number(rows[0].pkr_value)).toBe(7700)

    const { rows: stock } = await pool.query("SELECT available, avg_cost FROM stock_positions WHERE code = 'AED'")
    expect(Number(stock[0].available)).toBe(100)
    expect(Number(stock[0].avg_cost)).toBe(77)
  })
})
