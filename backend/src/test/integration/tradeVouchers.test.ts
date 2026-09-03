import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { resetBusinessData, ensureTestUser, insertCustomer } from '../dbFixtures.js'

// Requirement 7 phase 3 — trades post paired journal entries alongside everything they already do.
// Driven over real HTTP so the route, the transaction and the voucher all run exactly as in
// production. Nothing reads these rows yet; these tests are what says they are right.
describe('trades post vouchers', () => {
  let server: TestServer
  let admin: ApiClient
  let customerId: string

  const ADMIN = 'voucher-admin@currencydesk.local'
  const PASSWORD = 'test-password-123'

  beforeAll(async () => {
    await resetBusinessData(pool)
    await ensureTestUser(pool, ADMIN, PASSWORD, 'admin')
    customerId = await insertCustomer(pool, 'Voucher Customer')
    server = await startTestServer()
    admin = new ApiClient(server.baseUrl)
    expect((await admin.login(ADMIN, PASSWORD)).status).toBe(200)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM journal_entries')
    await pool.query('DELETE FROM activity')
    await pool.query("UPDATE stock_positions SET available = 0, avg_cost = 0")
    await pool.query('UPDATE accounts SET receivable = 0, payable = 0')
  })

  const trade = (extra: Record<string, unknown>) => ({
    customerId, currency: 'AED', method: 'Credit', paidNow: 0,
    bankId: '', chqNo: '', chqBank: '', ...extra,
  })

  /** The legs of the most recent voucher, with the noise columns dropped. */
  async function voucherLegs() {
    const { rows } = await pool.query(
      `SELECT debit_account, credit_account, amount::float8 AS amount, txn_date, voucher_id, activity_id, narration
       FROM journal_entries WHERE voucher_id IS NOT NULL
       ORDER BY amount DESC`,
    )
    return rows as any[]
  }
  const totals = (legs: any[]) => legs.reduce((t, l) => t + l.amount, 0)

  // --- purchases ----------------------------------------------------------

  it('a credit purchase debits currency stock and credits the customer', async () => {
    expect((await admin.post('/api/trades/purchase', trade({ amount: 1000, rate: 78 }))).status).toBe(200)

    const legs = await voucherLegs()
    expect(legs).toHaveLength(1)
    expect(legs[0].debit_account).toBe('currency')
    expect(legs[0].credit_account).toBe(customerId)
    expect(legs[0].amount).toBe(78_000)
    expect(legs[0].narration).toBe('Purchase — 1000 AED from Voucher Customer')
  })

  it('a part-paid cash purchase splits the credit between cash and the customer', async () => {
    expect((await admin.post('/api/trades/purchase', trade({ amount: 1000, rate: 78, method: 'Cash', paidNow: 30_000 }))).status).toBe(200)

    const legs = await voucherLegs()
    expect(legs).toHaveLength(2)
    expect(totals(legs), 'the two credits sum to the full cost').toBe(78_000)
    expect(legs.every((l) => l.debit_account === 'currency')).toBe(true)
    expect(legs.find((l) => l.credit_account === customerId).amount).toBe(48_000)
    expect(legs.find((l) => l.credit_account === 'cash').amount).toBe(30_000)
  })

  it('a cheque purchase posts nothing to the bank until the cheque clears', async () => {
    // ledgerBalance() already models it this way — Cheque-method activity is skipped and cleared
    // cheques counted instead. Posting the bank leg now would recognise money that has not moved.
    expect((await admin.post('/api/trades/purchase', trade({ amount: 1000, rate: 78, method: 'Cheque', paidNow: 78_000, chqNo: 'C-1', chqBank: 'Meezan' }))).status).toBe(200)

    const legs = await voucherLegs()
    expect(legs).toHaveLength(1)
    expect(legs[0].credit_account, 'the whole value sits against the customer').toBe(customerId)
    expect(legs[0].amount).toBe(78_000)
    expect(legs.some((l) => l.credit_account === 'bank')).toBe(false)
  })

  // --- sales --------------------------------------------------------------

  async function stockAt(rate: number, qty = 1000) {
    expect((await admin.post('/api/trades/purchase', trade({ amount: qty, rate }))).status).toBe(200)
    await pool.query('DELETE FROM journal_entries')
    await pool.query('UPDATE accounts SET receivable = 0, payable = 0')
  }

  it('a credit sale at a profit splits the credit between stock at cost and margin', async () => {
    await stockAt(78)
    expect((await admin.post('/api/trades/sale', trade({ amount: 1000, rate: 80 }))).status).toBe(200)

    const legs = await voucherLegs()
    expect(legs).toHaveLength(2)
    expect(legs.every((l) => l.debit_account === customerId)).toBe(true)
    expect(legs.find((l) => l.credit_account === 'currency').amount, 'stock leaves at cost').toBe(78_000)
    expect(legs.find((l) => l.credit_account === 'margin').amount, 'the rest is margin').toBe(2_000)
    expect(totals(legs)).toBe(80_000)
  })

  it('a part-paid sale allocates cash against cost first, then the customer covers the rest', async () => {
    await stockAt(78)
    expect((await admin.post('/api/trades/sale', trade({ amount: 1000, rate: 80, method: 'Cash', paidNow: 50_000 }))).status).toBe(200)

    const legs = await voucherLegs()
    expect(totals(legs)).toBe(80_000)
    // Greedy in the order given: cash settles cost before any profit is recognised as received.
    expect(legs.find((l) => l.debit_account === 'cash' && l.credit_account === 'currency').amount).toBe(50_000)
    expect(legs.find((l) => l.debit_account === customerId && l.credit_account === 'currency').amount).toBe(28_000)
    expect(legs.find((l) => l.debit_account === customerId && l.credit_account === 'margin').amount).toBe(2_000)
    expect(legs).toHaveLength(3)
  })

  it('a sale at exactly cost posts no margin leg at all', async () => {
    // margin is exactly 0, and journal_entries carries CHECK (amount > 0) — a breakeven sale must
    // post one leg, not fail.
    await stockAt(78)
    expect((await admin.post('/api/trades/sale', trade({ amount: 1000, rate: 78 }))).status).toBe(200)

    const legs = await voucherLegs()
    expect(legs).toHaveLength(1)
    expect(legs[0].credit_account).toBe('currency')
    expect(legs[0].amount).toBe(78_000)
  })

  it('a sale at a LOSS debits margin instead of crediting it', async () => {
    // sellCalc does not clamp margin and nothing rejects selling below weighted-average cost, so
    // this is an ordinary outcome. A loss is a debit to Income reducing it — never a negative
    // credit, which postVoucher refuses outright.
    await stockAt(78)
    const res = await admin.post('/api/trades/sale', trade({ amount: 1000, rate: 75 }))
    expect(res.status, 'a loss-making sale must still go through').toBe(200)

    const legs = await voucherLegs()
    expect(legs).toHaveLength(2)
    // Both legs credit stock — the customer covers 75,000 of it and the margin debit covers the
    // 3,000 shortfall — so this sums rather than picking one.
    const toStock = legs.filter((l) => l.credit_account === 'currency').reduce((t, l) => t + l.amount, 0)
    expect(toStock, 'stock still leaves at full cost').toBe(78_000)

    const lossLeg = legs.find((l) => l.debit_account === 'margin')
    expect(lossLeg, 'the shortfall is debited to margin').toBeTruthy()
    expect(lossLeg.amount).toBe(3_000)
    expect(lossLeg.credit_account).toBe('currency')

    const dr = legs.filter((l) => l.debit_account === customerId).reduce((t, l) => t + l.amount, 0)
    expect(dr, 'the customer owes only the sale value').toBe(75_000)
  })

  // --- shared behaviour ---------------------------------------------------

  it('copies the deal date onto the voucher, so a backdated trade is not split across periods', async () => {
    expect((await admin.post('/api/trades/purchase', trade({ amount: 100, rate: 78, txnDate: '2026-07-15' }))).status).toBe(200)

    const legs = await voucherLegs()
    expect(legs[0].txn_date).toBe('2026-07-15')

    const { rows } = await pool.query<{ txn_date: string }>('SELECT txn_date FROM activity LIMIT 1')
    expect(legs[0].txn_date, 'the voucher carries what the activity row actually stored').toBe(rows[0].txn_date)
  })

  it('links every leg to its activity row under one voucher', async () => {
    expect((await admin.post('/api/trades/purchase', trade({ amount: 1000, rate: 78, method: 'Cash', paidNow: 30_000 }))).status).toBe(200)

    const { rows } = await pool.query<{ id: string }>('SELECT id FROM activity LIMIT 1')
    const legs = await voucherLegs()
    expect(new Set(legs.map((l) => l.voucher_id)).size).toBe(1)
    expect(legs.every((l) => l.activity_id === rows[0].id)).toBe(true)
  })

  it('still records the trade when the currency has no stock account, and posts no voucher', async () => {
    // The policy stockAccountIdFor leaves to its caller. Refusing a trade over bookkeeping nothing
    // reads yet would be a regression; the reconciliation harness surfaces the gap as drift instead.
    await pool.query("DELETE FROM accounts WHERE id = 'currencyAFN'")
    try {
      const res = await admin.post('/api/trades/purchase', trade({ currency: 'AFN', amount: 500, rate: 4 }))
      expect(res.status, 'the trade itself must still succeed').toBe(200)

      const { rows: act } = await pool.query("SELECT 1 FROM activity WHERE currency = 'AFN'")
      expect(act, 'the activity row is written as normal').toHaveLength(1)
      expect(await voucherLegs(), 'but no half-voucher is posted').toHaveLength(0)
    } finally {
      await pool.query(
        `INSERT INTO accounts (id, type, name, is_system, code, notes)
         VALUES ('currencyAFN', 'Currency Stock', 'Currency stock (AFN)', true, 'AFN', '')`,
      )
    }
  })
})
