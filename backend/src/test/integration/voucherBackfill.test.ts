import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { PoolClient } from 'pg'
import { pool } from '../../db/pool.js'
import { backfillVouchers } from '../../services/voucherBackfill.js'
import { truncateAndReseedTestDb, insertCustomer } from '../dbFixtures.js'

// The backfill's REPORTING, specifically.
//
// The decisions underneath it are already covered elsewhere — buildVoucherLegs returning null for a
// missing account, postVoucher dropping zero-amount legs, stockAccountIdFor returning null. What is
// not covered anywhere else is whether the tallies and reasons this produces describe what actually
// happened.
//
// That matters more here than it would anywhere else in the project: this is the one piece of code
// that writes directly to production books, and its dry-run output is the thing a person reads
// before typing --apply. A right decision reported wrongly — miscounted, or attributed to the wrong
// reason — makes a dry run look clean when it is not, and nothing else would catch it.
describe('voucher backfill reporting', () => {
  let client: PoolClient
  let customerId: string

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    customerId = await insertCustomer(pool, 'Backfill Customer')
    client = await pool.connect()
  })

  afterAll(async () => {
    client.release()
    await pool.end()
  })

  beforeEach(async () => {
    await client.query('DELETE FROM journal_entries')
    await client.query('DELETE FROM activity')
    await client.query('DELETE FROM cheques')
    await client.query("UPDATE stock_positions SET available = 0, avg_cost = 0")
    await client.query(
      `INSERT INTO accounts (id, type, name, is_system, code, notes)
       VALUES ('currencyAFN', 'Currency Stock', 'Currency stock (AFN)', true, 'AFN', '')
       ON CONFLICT (id) DO NOTHING`,
    )
  })

  /** A credit purchase that should back-fill cleanly: one debit, one credit. */
  async function goodPurchase(currency = 'AED'): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, method, outstanding, txn_date)
       VALUES ('purchase', $2, $1, 'Backfill Customer', 100, 78, 7800, 'Credit', 7800, '2026-08-01') RETURNING id`,
      [customerId, currency],
    )
    return rows[0].id
  }

  it('counts a clean deal as posted, with its legs', async () => {
    await goodPurchase()
    const report = await backfillVouchers(client, null)

    expect(report.activity.considered).toBe(1)
    expect(report.activity.posted).toBe(1)
    expect(report.activity.legs).toBe(1)
    expect(report.activity.skipped).toHaveLength(0)
  })

  it('reports a row with no customer as skipped, and does not count it as posted', async () => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, method, outstanding, txn_date)
       VALUES ('purchase', 'AED', NULL, 'Walk-in', 100, 78, 7800, 'Credit', 7800, '2026-08-01') RETURNING id`,
    )
    const report = await backfillVouchers(client, null)

    expect(report.activity.considered).toBe(1)
    expect(report.activity.posted).toBe(0)
    expect(report.activity.legs).toBe(0)
    expect(report.activity.skipped).toEqual([{ id: rows[0].id, why: 'no customer on the row' }])
  })

  it('reports a currency with no stock account by name, not as a generic failure', async () => {
    // The reason has to identify WHICH currency: a dry run listing "skipped — no account" against
    // an id tells a reader nothing they can act on.
    await client.query("DELETE FROM accounts WHERE id = 'currencyAFN'")
    const id = await goodPurchase('AFN')
    const report = await backfillVouchers(client, null)

    expect(report.activity.considered).toBe(1)
    expect(report.activity.posted).toBe(0)
    expect(report.activity.skipped).toEqual([{ id, why: 'no account for AFN stock' }])
  })

  it('reports a cheque-settled settlement as nothing to post', async () => {
    // Correct, not a failure: a settlement taken by cheque moves nothing until the cheque clears,
    // so there is no voucher to write. It still has to appear in the tally rather than vanish.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO activity (type, customer_id, customer_name, amount, pkr_value, method, cheque_held, outstanding, txn_date)
       VALUES ('receive', $1, 'Backfill Customer', 5000, 5000, 'Cheque', true, 0, '2026-08-03') RETURNING id`,
      [customerId],
    )
    const report = await backfillVouchers(client, null)

    expect(report.activity.considered).toBe(1)
    expect(report.activity.posted).toBe(0)
    expect(report.activity.skipped).toEqual([{ id: rows[0].id, why: 'nothing to post (cheque-settled, or zero)' }])
  })

  it('tallies a mixed run correctly — considered covers posted and skipped together', async () => {
    // The arithmetic a reader will do in their head when deciding whether the dry run looks right.
    await client.query("DELETE FROM accounts WHERE id = 'currencyAFN'")
    await goodPurchase()
    await goodPurchase()
    await goodPurchase('AFN')
    await client.query(
      `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, method, outstanding, txn_date)
       VALUES ('purchase', 'AED', NULL, 'Walk-in', 1, 78, 78, 'Credit', 78, '2026-08-01')`,
    )

    const report = await backfillVouchers(client, null)
    expect(report.activity.considered).toBe(4)
    expect(report.activity.posted).toBe(2)
    expect(report.activity.skipped).toHaveLength(2)
    expect(report.activity.posted + report.activity.skipped.length).toBe(report.activity.considered)
    expect(report.activity.skipped.map((s) => s.why).sort()).toEqual([
      'no account for AFN stock',
      'no customer on the row',
    ])
  })

  it('counts the legs of a multi-leg deal, not just the deals', async () => {
    // A part-paid sale is three legs under one voucher. "posted 1" without "legs 3" would understate
    // what is about to be written by two thirds.
    await client.query('UPDATE stock_positions SET available = 1000, avg_cost = 78 WHERE code = $1', ['AED'])
    await client.query(
      `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, cost, margin, method, paid_now, outstanding, settlement_account_id, txn_date)
       VALUES ('sale', 'AED', $1, 'Backfill Customer', 1000, 80, 80000, 78000, 2000, 'Cash', 50000, 30000, 'cash', '2026-08-05')`,
      [customerId],
    )
    const report = await backfillVouchers(client, null)

    expect(report.activity.posted).toBe(1)
    expect(report.activity.legs, 'cash→stock, customer→stock, customer→margin').toBe(3)
  })

  it('reports a cleared cheque with no customer as skipped', async () => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO cheques (direction, number, party, customer_id, bank, bank_account_id, amount, due_date, status, ledger_applied)
       VALUES ('Inward', 'C-100', 'Walk-in', NULL, 'Meezan', 'bank', 4000, '2026-08-10', 'Cleared', true) RETURNING id`,
    )
    const report = await backfillVouchers(client, null)

    expect(report.cheques.considered).toBe(1)
    expect(report.cheques.posted).toBe(0)
    expect(report.cheques.skipped).toEqual([{ id: rows[0].id, why: 'no customer on the cheque' }])
  })

  it('does not consider a cheque that is not Cleared', async () => {
    await client.query(
      `INSERT INTO cheques (direction, number, party, customer_id, bank, bank_account_id, amount, due_date, status)
       VALUES ('Inward', 'C-101', 'Backfill Customer', $1, 'Meezan', 'bank', 4000, '2026-08-10', 'Deposited')`,
      [customerId],
    )
    const report = await backfillVouchers(client, null)
    expect(report.cheques.considered, 'only clearing moves money').toBe(0)
  })

  it('reports nothing left to consider on a second run', async () => {
    // Re-runnability is what makes recovery from a partial failure a re-run rather than an
    // unpicking exercise. A second pass must report zero, not re-post.
    await goodPurchase()
    const first = await backfillVouchers(client, null)
    const second = await backfillVouchers(client, null)

    expect(first.activity.posted).toBe(1)
    expect(second.activity.considered).toBe(0)
    expect(second.activity.posted).toBe(0)

    const { rows } = await client.query('SELECT 1 FROM journal_entries WHERE voucher_id IS NOT NULL')
    expect(rows, 'one voucher, one leg, not two').toHaveLength(1)
  })

  it('touches nothing but journal_entries', async () => {
    // The scope claim, asserted rather than assumed.
    await client.query('UPDATE accounts SET receivable = 1234, payable = 4321 WHERE id = $1', [customerId])
    await client.query('UPDATE stock_positions SET available = 555, avg_cost = 77 WHERE code = $1', ['AED'])
    await goodPurchase()

    await backfillVouchers(client, null)

    const acct = await client.query<{ receivable: number; payable: number }>(
      'SELECT receivable::float8 AS receivable, payable::float8 AS payable FROM accounts WHERE id = $1',
      [customerId],
    )
    expect(acct.rows[0]).toEqual({ receivable: 1234, payable: 4321 })

    const stock = await client.query<{ available: number; avg_cost: number }>(
      "SELECT available::float8 AS available, avg_cost::float8 AS avg_cost FROM stock_positions WHERE code = 'AED'",
    )
    expect(stock.rows[0]).toEqual({ available: 555, avg_cost: 77 })
  })
})
