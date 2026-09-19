import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { truncateAndReseedTestDb, ensureTestUser, insertCustomer } from '../dbFixtures.js'

// Clearing a cheque for MORE than the customer owes.
//
// Until 2026-09-19 this ran a plain `UPDATE accounts SET receivable = receivable - $1` with no
// guard of any kind, and `accounts.receivable` carries no CHECK — so the column simply went
// NEGATIVE. The net was arithmetically right and the split was wrong, which is the half anyone
// reads: "Receivable −70,000" where the books mean "Payable 70,000". It also understated the
// TopBar total and would have let deleteAccount's balance check pass for a customer still owed
// money. Cheque clearing was the only balance-moving path with neither a guard nor an allocation.
//
// The client chose option A from AUDIT.md §3 #3: the excess is not handed back over the counter,
// it settles the debt and the remainder stays as a credit for later — the same "settle the
// opposite direction first, then cross the remainder over" rule postJournal and the JV transfer
// already use.
describe('clearing a cheque for more than the customer owes', () => {
  let server: TestServer
  let admin: ApiClient
  let customerId: string

  const ADMIN = 'chq-overage@currencydesk.local'
  const PASSWORD = 'test-password-123'

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    await ensureTestUser(pool, ADMIN, PASSWORD, 'admin')
    customerId = await insertCustomer(pool, 'Overage Customer')
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
    await pool.query('DELETE FROM cheques')
    await pool.query('UPDATE accounts SET receivable = 0, payable = 0')
  })

  const set = (recv: number, pay: number) =>
    pool.query('UPDATE accounts SET receivable = $2, payable = $3 WHERE id = $1', [customerId, recv, pay])

  const balance = async () => {
    const { rows } = await pool.query<{ r: number; p: number }>(
      'SELECT receivable::float8 AS r, payable::float8 AS p FROM accounts WHERE id = $1',
      [customerId],
    )
    return { receivable: rows[0].r, payable: rows[0].p, net: rows[0].r - rows[0].p }
  }

  /** A cheque already Deposited and waiting to clear — the only state clearCheque accepts. */
  const depositedCheque = async (direction: 'Inward' | 'Outward', amount: number, number: string) => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO cheques (direction, number, party, customer_id, bank, bank_account_id, amount, due_date, status)
       VALUES ($1, $2, 'Overage Customer', $3, 'HBL', 'bank', $4, CURRENT_DATE, 'Deposited')
       RETURNING id`,
      [direction, number, customerId, amount],
    )
    return rows[0].id
  }

  // --- the scenario from the decision entry --------------------------------

  it('settles the debt and leaves the remainder as a credit, instead of going negative', async () => {
    // The exact sequence recorded in AUDIT.md §3 #3: the customer owed 100,000 and handed over a
    // 100,000 cheque, then a manual credit of 30,000 reduced the debt before the cheque cleared.
    await set(70_000, 0)
    const id = await depositedCheque('Inward', 100_000, 'OV-1001')

    expect((await admin.post(`/api/cheques/${id}/clear`)).status).toBe(200)

    const b = await balance()
    expect(b.receivable, 'the 70,000 owed is settled in full').toBe(0)
    expect(b.payable, 'the 30,000 excess stays with the desk as a credit').toBe(30_000)
    expect(b.receivable, 'and nothing is left negative — the old behaviour stored -30,000').toBeGreaterThanOrEqual(0)
    expect(b.payable).toBeGreaterThanOrEqual(0)
    expect(b.net).toBe(-30_000)
  })

  it('does the mirror for an outward cheque that exceeds what the desk owes', async () => {
    await set(0, 40_000)
    const id = await depositedCheque('Outward', 100_000, 'OV-1002')

    expect((await admin.post(`/api/cheques/${id}/clear`)).status).toBe(200)

    const b = await balance()
    expect(b.payable, 'what the desk owed is cleared').toBe(0)
    expect(b.receivable, 'the excess becomes theirs to answer for').toBe(60_000)
  })

  // --- the ordinary cases must be untouched --------------------------------

  it('still settles an exact-match cheque to zero', async () => {
    await set(50_000, 0)
    const id = await depositedCheque('Inward', 50_000, 'OV-1003')
    expect((await admin.post(`/api/cheques/${id}/clear`)).status).toBe(200)
    expect(await balance()).toEqual({ receivable: 0, payable: 0, net: 0 })
  })

  it('still leaves the balance outstanding on a part-covering cheque', async () => {
    await set(80_000, 0)
    const id = await depositedCheque('Inward', 30_000, 'OV-1004')
    expect((await admin.post(`/api/cheques/${id}/clear`)).status).toBe(200)

    const b = await balance()
    expect(b.receivable, 'only the cheque comes off').toBe(50_000)
    expect(b.payable, 'nothing crosses over — the cheque did not cover the debt').toBe(0)
  })

  it('moves the net by exactly the cheque, however the two columns end up split', async () => {
    // The invariant that has to hold whichever side the money lands on.
    const cases: [number, number, number][] = [
      [0, 0, 25_000],
      [10_000, 0, 25_000],
      [0, 10_000, 25_000],
      [40_000, 5_000, 25_000],
    ]
    let n = 0
    for (const [recv, pay, amount] of cases) {
      // Each pass writes its own cheque with its own number, so nothing is cleaned up between
      // them — and clearing one posts a voucher that references it, which an intervening DELETE
      // would trip over on journal_entries.cheque_id's foreign key.
      await set(recv, pay)
      const before = (await balance()).net
      const id = await depositedCheque('Inward', amount, `OV-2${n++}`)
      expect((await admin.post(`/api/cheques/${id}/clear`)).status).toBe(200)
      const after = await balance()
      expect(after.net, `Inward ${amount} on ${recv}/${pay}`).toBeCloseTo(before - amount, 2)
      expect(after.receivable, 'receivable never negative').toBeGreaterThanOrEqual(0)
      expect(after.payable, 'payable never negative').toBeGreaterThanOrEqual(0)
    }
  })

  // --- the rest of clearing is unaffected ----------------------------------

  it('still marks the cheque Cleared and refuses a second clearing', async () => {
    await set(70_000, 0)
    const id = await depositedCheque('Inward', 100_000, 'OV-3001')
    expect((await admin.post(`/api/cheques/${id}/clear`)).status).toBe(200)

    const { rows } = await pool.query<{ status: string; ledger_applied: boolean }>(
      'SELECT status, ledger_applied FROM cheques WHERE id = $1',
      [id],
    )
    expect(rows[0].status).toBe('Cleared')
    expect(rows[0].ledger_applied).toBe(true)

    // The guarded transition is what stops the allocation being applied twice.
    expect((await admin.post(`/api/cheques/${id}/clear`)).status).toBe(409)
    expect((await balance()).payable, 'the second attempt moved nothing').toBe(30_000)
  })

  it('still posts the clearing voucher', async () => {
    await set(70_000, 0)
    const id = await depositedCheque('Inward', 100_000, 'OV-3002')
    expect((await admin.post(`/api/cheques/${id}/clear`)).status).toBe(200)

    const { rows } = await pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM journal_entries WHERE cheque_id = $1', [id])
    expect(Number(rows[0].n), 'the voucher records the full cheque, whatever the split').toBeGreaterThan(0)
  })
})
