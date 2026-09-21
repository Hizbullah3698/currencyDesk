import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { truncateAndReseedTestDb, ensureTestUser, insertCustomer } from '../dbFixtures.js'
import { deskToday } from '../../config/deskTime.js'

// TMN (the Toman) is quoted the other way round from AED — the dealer types "TMN per 1 PKR" (~797)
// and the value is DIVIDED, not multiplied (see packages/engine/src/currencies.ts). Everything here
// asserts the ACTUAL numbers Postgres ends up holding, because the failure mode this guards
// against is not an error response: multiplying instead of dividing returns a perfectly happy
// 200 while booking the position at ~635,000 times its real cost.
//
// The figures are the client's own — his previous system's ledger books "SALE Dubai Tmn
// 3,000,000,000@797" — so these tests run at the scale the desk really trades, billions of units,
// not at a toy scale where a column width or a rounding step could hide.
describe('multi-currency trades (TMN divide-quote, txnDate)', () => {
  let server: TestServer
  let client: ApiClient
  let customerId: string

  // 3,000,000,000 TMN at 797 TMN per PKR.
  //   unit cost = 1 / 797          = 0.0012547051442910915 PKR per TMN
  //   pkr value = 3e9 / 797        = 3,764,115.4328732747 -> 3,764,115.43 in activity.pkr_value (18,2)
  const RATE_1 = 797
  const QTY_1 = 3_000_000_000
  const UNIT_1 = 1 / RATE_1

  // A second buy at a stronger toman: 5,000,000,000 TMN at 787 TMN per PKR.
  //   unit cost = 1 / 787          = 0.0012706480304955528 PKR per TMN
  //   pkr value = 5e9 / 787        = 6,353,240.152477764 -> 6,353,240.15
  const RATE_2 = 787
  const QTY_2 = 5_000_000_000
  const UNIT_2 = 1 / RATE_2

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
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
    currency: 'TMN',
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

    const { rows } = await pool.query("SELECT * FROM activity WHERE type = 'purchase' AND currency = 'TMN'")
    expect(rows).toHaveLength(1)
    const row = rows[0]

    // Stored PKR value: 3,764,115.43 — the client's ledger prints 3,764,115 — not 2,391,000,000,000.
    expect(Number(row.pkr_value)).toBeCloseTo(3764115.43, 2)
    expect(Math.round(Number(row.pkr_value))).toBe(3_764_115)
    expect(Number(row.outstanding)).toBeCloseTo(3764115.43, 2)
    // The rate is stored EXACTLY as the dealer typed it, in TMN's own quote convention — engine's
    // unitPkr() re-derives PKR-per-unit from it on every replay, so storing an already-converted
    // value here would double-convert every report that reads it back.
    expect(Number(row.rate)).toBe(RATE_1)
    expect(Number(row.amount)).toBe(QTY_1)

    const { rows: stock } = await pool.query("SELECT available, avg_cost FROM stock_positions WHERE code = 'TMN'")
    expect(Number(stock[0].available)).toBe(QTY_1)
    // 0.001254705144..., held to 12 decimals by migration 012's widened column. numeric(18,6) would
    // have rounded this to 0.001255 (a 0.023% error that compounds on every re-weight).
    expect(Number(stock[0].avg_cost)).toBeCloseTo(UNIT_1, 12)
    // The whole position's cost basis in PKR — the number the Balance Sheet carries. Two decimals
    // of tolerance, not three: avg_cost is stored to 12 places, and at three BILLION units the
    // last stored digit is worth ~0.0015 PKR, so a tighter bound would be asserting on the column
    // width rather than on the arithmetic.
    expect(Number(stock[0].available) * Number(stock[0].avg_cost)).toBeCloseTo(3764115.433, 2)

    // The customer is owed the PKR value, not the raw rate x amount.
    const { rows: cust } = await pool.query('SELECT payable FROM accounts WHERE id = $1', [customerId])
    expect(Number(cust[0].payable)).toBeCloseTo(3764115.43, 2)
  })

  it('re-weights the average cost against the stored PKR-per-unit, not the typed quote rate', async () => {
    const res = await client.post('/api/trades/purchase', purchaseBody(QTY_2, RATE_2))
    expect(res.status).toBe(200)

    const { rows: stock } = await pool.query("SELECT available, avg_cost FROM stock_positions WHERE code = 'TMN'")
    expect(Number(stock[0].available)).toBe(QTY_1 + QTY_2)

    // (3e9 x 0.001254705 + 5e9 x 0.001270648) / 8e9 = 10,117,355.585 / 8e9
    //                                               = 0.001264669448...
    const expectedAvg = (QTY_1 * UNIT_1 + QTY_2 * UNIT_2) / (QTY_1 + QTY_2)
    expect(expectedAvg).toBeCloseTo(0.001264669448, 11)
    expect(Number(stock[0].avg_cost)).toBeCloseTo(expectedAvg, 11)
    // Total cost basis = 3,764,115.43 + 6,353,240.15. Two decimals of tolerance for the reason
    // given on the first purchase: eight billion units magnify the 12th stored decimal.
    expect(Number(stock[0].available) * Number(stock[0].avg_cost)).toBeCloseTo(10117355.585, 2)

    const { rows } = await pool.query("SELECT pkr_value FROM activity WHERE type = 'purchase' AND rate = $1", [RATE_2])
    // The client's ledger prints 6,353,240; the column holds 6,353,240.15.
    expect(Number(rows[0].pkr_value)).toBeCloseTo(6353240.15, 2)
    expect(Math.round(Number(rows[0].pkr_value))).toBe(6_353_240)
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

  it('rejects IRR outright now that the desk trades Toman — a stale Rial code must never book', async () => {
    // Renamed in migration 021. If IRR were merely left unrecognised, the engine would treat it as
    // an ordinary multiply currency and book a Rial-typed trade at its typed rate times its amount.
    // It is refused instead, and nothing is created for it.
    const res = await client.post('/api/trades/purchase', { ...purchaseBody(1_000_000, 4952.53), currency: 'IRR' })
    expect(res.status).toBe(400)
    expect(res.json.error).toMatch(/Unknown currency "IRR"/)

    const { rows } = await pool.query("SELECT code FROM stock_positions WHERE code = 'IRR'")
    expect(rows).toHaveLength(0)
    const { rows: acts } = await pool.query("SELECT 1 FROM activity WHERE upper(currency) = 'IRR'")
    expect(acts).toHaveLength(0)
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

  it('rejects an absurd amount or rate with a 400, not a Postgres overflow 500 — AUDIT.md §3 #12', async () => {
    // The string "1e400" is what a malformed client sends; the server's Number() turns it into
    // Infinity, which passes every `> 0` check. "2e13" is finite but over every numeric column's
    // ceiling. Both used to reach the INSERT and surface as "numeric field overflow" -> 500.
    // (A JS `Infinity` value cannot be used directly — JSON.stringify turns it into null.)
    for (const amount of ['1e400', '2e13'] as const) {
      const res = await client.post('/api/trades/purchase', purchaseBody(1000, RATE_2, { amount }))
      expect(res.status, `amount ${amount} should be a clean 400`).toBe(400)
      expect(res.json.error).toMatch(/too large|not a valid number/i)
    }
    const badRate = await client.post('/api/trades/purchase', purchaseBody(1000, RATE_2, { rate: '1e400' }))
    expect(badRate.status).toBe(400)
    expect(badRate.json.error).toMatch(/rate/i)

    const badSettle = await client.post('/api/settlements/receive', {
      customerId, amount: '9e20', method: 'Cash', bankId: '', chqNo: '', chqBank: '',
    })
    expect(badSettle.status).toBe(400)
    expect(badSettle.json.error).toMatch(/too large/i)

    // Nothing was written by any of the above.
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM activity WHERE pkr_value > 1e12')
    expect(rows[0].n).toBe(0)
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

  it('values a TMN sale by dividing the sale rate while costing it at the stored PKR-per-unit', async () => {
    // Expectations are derived from whatever the position actually holds at this point rather
    // than from a hard-coded figure, because the two sides of the assertion are the point: the
    // sale RATE must be divided (quote convention) while avg_cost must be multiplied (already
    // canonical). Getting either one backwards changes the result by ~6 orders of magnitude.
    //
    // 3,000,000,000 TMN at 788 is the client's own third ledger line (DTMS6221): 3,807,106.60 PKR,
    // which his statement prints as 3,807,107.
    const { rows: before } = await pool.query("SELECT available, avg_cost FROM stock_positions WHERE code = 'TMN'")
    const avgCost = Number(before[0].avg_cost)
    const qty = 3_000_000_000
    const sellRate = 788

    const res = await client.post('/api/trades/sale', {
      ...purchaseBody(qty, sellRate),
      customerId,
    })
    expect(res.status).toBe(200)

    const { rows } = await pool.query("SELECT id, amount, rate, pkr_value, cost, margin FROM activity WHERE type = 'sale' AND currency = 'TMN'")
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].rate)).toBe(sellRate)
    expect(Number(rows[0].pkr_value)).toBeCloseTo(qty / sellRate, 2)
    expect(Math.round(Number(rows[0].pkr_value))).toBe(3_807_107)
    expect(Number(rows[0].cost)).toBeCloseTo(qty * avgCost, 2)
    expect(Number(rows[0].margin)).toBeCloseTo(qty / sellRate - qty * avgCost, 2)
    // ~3.81 million PKR of proceeds against ~3.79 million of cost — seven-figure PKR numbers
    // either way, not the trillions a mis-multiplied rate would produce.
    expect(Number(rows[0].pkr_value)).toBeLessThan(10_000_000)
    expect(Number(rows[0].cost)).toBeLessThan(10_000_000)
    expect(Number(rows[0].margin)).toBeGreaterThan(0)

    // THE THREE FIGURES SUM, EXACTLY — AUDIT.md §3 #4, fixed 2026-09-21. This used to be
    // deliberately NOT asserted, because pkr_value, cost and margin were rounded independently.
    // Compared in whole paisa, so it is an equality rather than a tolerance. NOTE this sale does
    // not itself reproduce the old fault — the extra purchases earlier in this file shift the
    // average cost onto a paisa that happens to sum — so this is a standing invariant, not the
    // regression test. sale.rounding.test.ts runs the client's exact sequence and is that test.
    const paisa = (v: unknown) => Math.round(Number(v) * 100)
    expect(paisa(rows[0].cost) + paisa(rows[0].margin), 'cost + margin must equal pkr_value to the paisa').toBe(paisa(rows[0].pkr_value))

    // And the voucher agrees with the balance that moved. The customer's receivable rose by
    // pkr_value; the sale voucher must debit that same customer by exactly that much, or the journal
    // and the stored balance drift apart by the paisa — which is what `npm run reconcile` caught.
    const { rows: legs } = await pool.query(
      'SELECT COALESCE(SUM(amount), 0)::float8 AS debited FROM journal_entries WHERE activity_id = $1 AND debit_account = $2',
      [rows[0].id, customerId],
    )
    expect(paisa(legs[0].debited), 'voucher debit to the customer').toBe(paisa(rows[0].pkr_value))

    // A sale moves quantity only — the weighted-average cost is untouched.
    const { rows: after } = await pool.query("SELECT available, avg_cost FROM stock_positions WHERE code = 'TMN'")
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
