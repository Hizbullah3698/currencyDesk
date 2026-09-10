import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { PoolClient } from 'pg'
import { pool } from '../../db/pool.js'
import { postOpeningStockEntries } from '../../services/openingStockService.js'
import { truncateAndReseedTestDb, insertCustomer } from '../dbFixtures.js'

// Journalling the currency the desk held before the recorded ledger begins — the one legitimately
// unjournalled figure on the balance sheet, and the reason the reconciliation harness could not
// otherwise reach zero.
describe('opening currency stock entries', () => {
  let client: PoolClient
  let customerId: string

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    customerId = await insertCustomer(pool, 'Opening Stock Customer')
    client = await pool.connect()
  })

  afterAll(async () => {
    client.release()
    await pool.end()
  })

  beforeEach(async () => {
    await client.query('DELETE FROM journal_entries')
    await client.query('DELETE FROM activity')
    await client.query('UPDATE stock_positions SET available = 0, avg_cost = 0')
  })

  /** A position with no purchase behind it — exactly what "held before the ledger began" means. */
  const holdWithNoHistory = (code: string, qty: number, avgCost: number) =>
    client.query('UPDATE stock_positions SET available = $2, avg_cost = $3 WHERE code = $1', [code, qty, avgCost])

  const entries = async () =>
    (await client.query(
      `SELECT debit_account, credit_account, amount::float8 AS amount, txn_date, opening_for, voucher_id, narration
       FROM journal_entries ORDER BY amount DESC`,
    )).rows as any[]

  it('posts Dr Currency Stock / Cr Capital for a pre-ledger position', async () => {
    await holdWithNoHistory('AED', 1000, 78)
    const results = await postOpeningStockEntries(client, null)

    const aed = results.find((r) => r.code === 'AED')!
    expect(aed.posted).toBe(true)
    expect(aed.value).toBe(78_000)

    const rows = await entries()
    expect(rows).toHaveLength(1)
    expect(rows[0].debit_account).toBe('currency')
    expect(rows[0].credit_account).toBe('capital')
    expect(rows[0].amount).toBe(78_000)
    expect(rows[0].narration).toBe('Opening currency stock — AED')
  })

  it('carries a voucher_id, so it stays invisible to the reports until phase 5', async () => {
    // The load-bearing detail. openingStockEquity is computed from openingStock() independently of
    // the journal, and unexplained = rawDiff − openingStockEquity. A visible entry would credit
    // Capital through ledgerBalance(), drive rawDiff to zero, and leave unexplained at
    // −openingStockEquity — turning a balanced sheet into one reporting an imbalance that is not
    // there. isVoucherLeg() excludes anything with a voucher_id.
    await holdWithNoHistory('AED', 1000, 78)
    await postOpeningStockEntries(client, null)

    const rows = await entries()
    expect(rows[0].voucher_id, 'must be inert like every other phase 3/4 row').not.toBeNull()
  })

  it('marks it with opening_for, the column createAccount already uses', async () => {
    await holdWithNoHistory('AED', 1000, 78)
    await postOpeningStockEntries(client, null)
    expect((await entries())[0].opening_for).toBe('currency')
  })

  it('is idempotent — running twice does not post a second entry', async () => {
    // A backfill that cannot be safely resumed after a partial failure has to be unpicked by hand,
    // against the live books.
    await holdWithNoHistory('AED', 1000, 78)
    await postOpeningStockEntries(client, null)
    const second = await postOpeningStockEntries(client, null)

    expect(await entries()).toHaveLength(1)
    expect(second.find((r) => r.code === 'AED')!.posted).toBe(false)
    expect(second.find((r) => r.code === 'AED')!.skipped).toMatch(/already has an opening entry/)
  })

  it('posts nothing for a currency with no pre-ledger position', async () => {
    const results = await postOpeningStockEntries(client, null)
    expect(await entries()).toHaveLength(0)
    expect(results.every((r) => !r.posted)).toBe(true)
    expect(results.find((r) => r.code === 'USD')!.skipped).toMatch(/no pre-ledger position/)
  })

  it('excludes stock that a recorded purchase already accounts for', async () => {
    // The distinction the whole thing rests on: a position built by recorded activity is already
    // journalled by that activity's own voucher. Only what predates the history belongs here.
    await client.query(
      `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, method, outstanding, txn_date)
       VALUES ('purchase', 'AED', $1, 'Opening Stock Customer', 400, 78, 31200, 'Credit', 31200, '2026-08-01')`,
      [customerId],
    )
    // 1000 on hand, 400 of which arrived through the purchase above.
    await holdWithNoHistory('AED', 1000, 78)

    const aed = (await postOpeningStockEntries(client, null)).find((r) => r.code === 'AED')!
    expect(aed.qty, 'only the 600 that predates the ledger').toBe(600)
    expect(aed.value).toBe(46_800)
  })

  it('dates the entry before the earliest movement, however far back it was dated', async () => {
    // A balance sheet cut between the opening position and the first deal must show the stock as
    // already held. Backdating means the account's own creation date is not a safe floor.
    await client.query(
      `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, method, outstanding, txn_date)
       VALUES ('purchase', 'AED', $1, 'Opening Stock Customer', 100, 78, 7800, 'Credit', 7800, '2026-01-15')`,
      [customerId],
    )
    await holdWithNoHistory('AED', 1000, 78)
    await postOpeningStockEntries(client, null)

    expect((await entries())[0].txn_date).toBe('2026-01-14')
  })

  it('infers a pre-ledger holding from a sale with no purchase behind it', async () => {
    // Worth pinning because it reads backwards at first glance. A sale of 500 with nothing left on
    // hand means the desk HELD 500 before the ledger began and sold it — openingStock unwinds the
    // sale back onto the position, giving +500, not a negative.
    await client.query(
      `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, cost, margin, method, outstanding, txn_date)
       VALUES ('sale', 'AED', $1, 'Opening Stock Customer', 500, 80, 40000, 39000, 1000, 'Credit', 40000, '2026-08-02')`,
      [customerId],
    )
    await holdWithNoHistory('AED', 0, 78)

    const aed = (await postOpeningStockEntries(client, null)).find((r) => r.code === 'AED')!
    expect(aed.qty).toBe(500)
    expect(aed.posted).toBe(true)
  })

  it('refuses a negative opening position rather than posting a backwards entry', async () => {
    // A purchase of 500 with nothing on hand and no sale to explain where it went. Unwinding it
    // gives −500: the recorded history cannot be reconciled with the position, which is a data
    // problem, not something to paper over with a reversed entry.
    await client.query(
      `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, method, outstanding, txn_date)
       VALUES ('purchase', 'AED', $1, 'Opening Stock Customer', 500, 78, 39000, 'Credit', 39000, '2026-08-02')`,
      [customerId],
    )
    await holdWithNoHistory('AED', 0, 78)

    const aed = (await postOpeningStockEntries(client, null)).find((r) => r.code === 'AED')!
    expect(aed.posted).toBe(false)
    expect(aed.skipped).toMatch(/negative opening position/)
    expect(await entries(), 'nothing is written').toHaveLength(0)
  })
})
