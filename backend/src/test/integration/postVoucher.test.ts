import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { PoolClient } from 'pg'
import { pool } from '../../db/pool.js'
import { postVoucher } from '../../services/journalService.js'
import { resetBusinessData, insertCustomer } from '../dbFixtures.js'

// postVoucher writes the legs of one deal as several journal rows sharing a voucher_id.
// Requirement 7 phase 3; nothing reads these rows yet.
describe('postVoucher', () => {
  let client: PoolClient
  let customerId: string

  const TXN_DATE = '2026-08-21'

  beforeAll(async () => {
    await resetBusinessData(pool)
    customerId = await insertCustomer(pool, 'Voucher Test Customer')
    client = await pool.connect()
  })

  afterAll(async () => {
    client.release()
    await pool.end()
  })

  beforeEach(async () => {
    await client.query('DELETE FROM journal_entries')
  })

  /** A stand-in activity id. Legs carry a real FK to activity, so the row has to exist. */
  async function anActivityRow(txnDate = TXN_DATE): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, method, txn_date)
       VALUES ('purchase', 'AED', $1, 'Voucher Test Customer', 1000, 78, 78000, 'Credit', $2::date)
       RETURNING id`,
      [customerId, txnDate],
    )
    return rows[0].id
  }

  const legsOf = (voucherId: string) =>
    client.query(
      'SELECT * FROM journal_entries WHERE voucher_id = $1 ORDER BY amount DESC',
      [voucherId],
    )

  it('writes every leg under one voucher_id, linked to the activity row', async () => {
    const activityId = await anActivityRow()
    const voucherId = await postVoucher(
      client,
      {
        activityId,
        txnDate: TXN_DATE,
        narration: 'Purchase — 1,000 AED from Voucher Test Customer',
        legs: [
          { debitAccount: 'currency', creditAccount: 'cash', amount: 50_000 },
          { debitAccount: 'currency', creditAccount: customerId, amount: 28_000 },
        ],
      },
      null,
    )

    expect(voucherId).toBeTruthy()
    const { rows } = await legsOf(voucherId!)
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.voucher_id).toBe(voucherId)
      expect(r.activity_id).toBe(activityId)
      expect(r.narration).toBe('Purchase — 1,000 AED from Voucher Test Customer')
    }
    expect(rows.map((r: any) => Number(r.amount))).toEqual([50_000, 28_000])
  })

  it('copies the transaction date onto every leg rather than defaulting to today', async () => {
    // The whole reason journal entries got their own txn_date. A backdated deal whose voucher
    // landed on today's date would put the two halves of one trade in different periods.
    const activityId = await anActivityRow('2026-07-04')
    const voucherId = await postVoucher(
      client,
      {
        activityId,
        txnDate: '2026-07-04',
        narration: 'Backdated deal',
        legs: [{ debitAccount: 'currency', creditAccount: 'cash', amount: 1_000 }],
      },
      null,
    )

    const { rows } = await legsOf(voucherId!)
    // The DATE parser in db/pool.ts hands back literal text, so no timezone can shift the day.
    expect(rows[0].txn_date).toBe('2026-07-04')

    const { rows: today } = await client.query<{ today: string }>('SELECT CURRENT_DATE::text AS today')
    expect(rows[0].txn_date, 'must not have fallen back to the column default').not.toBe(today[0].today)
  })

  it('drops a zero-amount leg instead of failing the whole posting', async () => {
    // A sale at exactly weighted-average cost has a margin of 0, and journal_entries carries
    // CHECK (amount > 0) — so posting that leg would reject an ordinary trade.
    const activityId = await anActivityRow()
    const voucherId = await postVoucher(
      client,
      {
        activityId,
        txnDate: TXN_DATE,
        narration: 'Sale at cost',
        legs: [
          { debitAccount: customerId, creditAccount: 'currency', amount: 78_000 },
          { debitAccount: customerId, creditAccount: 'margin', amount: 0 },
        ],
      },
      null,
    )

    const { rows } = await legsOf(voucherId!)
    expect(rows, 'the margin leg is dropped, the cost leg still posts').toHaveLength(1)
    expect(rows[0].credit_account).toBe('currency')
  })

  it('writes nothing and returns null when every leg is zero', async () => {
    const activityId = await anActivityRow()
    const voucherId = await postVoucher(
      client,
      { activityId, txnDate: TXN_DATE, narration: 'Nothing to post', legs: [{ debitAccount: 'cash', creditAccount: 'margin', amount: 0 }] },
      null,
    )
    expect(voucherId).toBeNull()

    const { rows } = await client.query('SELECT 1 FROM journal_entries')
    expect(rows).toHaveLength(0)
  })

  it('raises on a negative amount rather than silently dropping it', async () => {
    // Not a business case — every figure reaching here comes from buyCalc/sellCalc, which cannot
    // produce one. Dropping it would hide a caller bug as a quietly missing leg.
    const activityId = await anActivityRow()
    await expect(
      postVoucher(
        client,
        { activityId, txnDate: TXN_DATE, narration: 'Bad', legs: [{ debitAccount: 'cash', creditAccount: 'margin', amount: -5 }] },
        null,
      ),
    ).rejects.toThrow(/negative amount/i)
  })

  it('raises when a leg debits and credits the same account', async () => {
    const activityId = await anActivityRow()
    await expect(
      postVoucher(
        client,
        { activityId, txnDate: TXN_DATE, narration: 'Bad', legs: [{ debitAccount: 'cash', creditAccount: 'cash', amount: 10 }] },
        null,
      ),
    ).rejects.toThrow(/same account/i)
  })

  it('resolves the account names into the stored labels', async () => {
    const activityId = await anActivityRow()
    const voucherId = await postVoucher(
      client,
      { activityId, txnDate: TXN_DATE, narration: 'Labelled', legs: [{ debitAccount: 'currency', creditAccount: 'cash', amount: 100 }] },
      null,
    )
    const { rows } = await legsOf(voucherId!)
    expect(rows[0].debit_label).toBe('Currency stock (AED)')
    expect(rows[0].credit_label).toBe('Cash in hand')
  })

  it('lets a leg override the voucher narration', async () => {
    const activityId = await anActivityRow()
    const voucherId = await postVoucher(
      client,
      {
        activityId,
        txnDate: TXN_DATE,
        narration: 'Sale — 1,000 AED',
        legs: [
          { debitAccount: customerId, creditAccount: 'currency', amount: 78_000 },
          { debitAccount: customerId, creditAccount: 'margin', amount: 2_000, narration: 'Sale — 1,000 AED · margin' },
        ],
      },
      null,
    )
    const { rows } = await legsOf(voucherId!)
    expect(rows.find((r: any) => r.credit_account === 'currency').narration).toBe('Sale — 1,000 AED')
    expect(rows.find((r: any) => r.credit_account === 'margin').narration).toBe('Sale — 1,000 AED · margin')
  })

  it('still assigns each leg its own JV ref, which is not the deal identifier', async () => {
    // Documenting the consequence of the ref decision rather than leaving it to be rediscovered:
    // refs come from a sequence per row, so a two-leg deal consumes two of them. The deal is
    // identified by its activity row, not by a JV number, and nothing surfaces these per leg.
    const activityId = await anActivityRow()
    const voucherId = await postVoucher(
      client,
      {
        activityId,
        txnDate: TXN_DATE,
        narration: 'Two legs',
        legs: [
          { debitAccount: 'currency', creditAccount: 'cash', amount: 10 },
          { debitAccount: 'currency', creditAccount: customerId, amount: 20 },
        ],
      },
      null,
    )
    const { rows } = await legsOf(voucherId!)
    const refs = rows.map((r: any) => r.ref)
    expect(new Set(refs).size, 'each leg takes its own ref').toBe(2)
    expect(new Set(rows.map((r: any) => r.voucher_id)).size, 'but they share one voucher').toBe(1)
  })

  it('produces a voucher that cannot be unbalanced, by construction', async () => {
    // Each row is one debit against one credit for one amount, so total debits equal total credits
    // for any set of legs. There is no imbalance to check for, and this pins that property.
    const activityId = await anActivityRow()
    const voucherId = await postVoucher(
      client,
      {
        activityId,
        txnDate: TXN_DATE,
        narration: 'Four legs',
        legs: [
          { debitAccount: 'cash', creditAccount: 'currency', amount: 30_000 },
          { debitAccount: customerId, creditAccount: 'currency', amount: 48_000 },
          { debitAccount: 'cash', creditAccount: 'margin', amount: 1_500 },
          { debitAccount: customerId, creditAccount: 'margin', amount: 2_400 },
        ],
      },
      null,
    )
    const { rows } = await client.query<{ dr: number; cr: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS dr,
              (SELECT COALESCE(SUM(amount), 0) FROM journal_entries WHERE voucher_id = $1) AS cr
       FROM journal_entries WHERE voucher_id = $1`,
      [voucherId],
    )
    expect(Number(rows[0].dr)).toBe(Number(rows[0].cr))
    expect(Number(rows[0].dr)).toBe(81_900)
  })
})
