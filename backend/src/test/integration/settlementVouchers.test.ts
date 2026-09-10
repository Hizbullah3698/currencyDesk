import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { resetBusinessData, ensureTestUser, insertCustomer } from '../dbFixtures.js'
import { deskToday } from '../../config/deskTime.js'

// Requirement 7 phase 3, step 4 — receipts, payments and cheque clearing post paired entries.
//
// The theme running through all of these is that a cheque moves nothing until it clears. The
// settlement itself is recorded, the balance is untouched, and no voucher is written; clearing is
// where both finally happen. That is not new behaviour invented here — it is what the balance
// update in settlementsService and ledgerBalance()'s cheque handling have always done.
describe('settlements and cheque clearing post vouchers', () => {
  let server: TestServer
  let admin: ApiClient
  let customerId: string

  const ADMIN = 'settle-voucher-admin@currencydesk.local'
  const PASSWORD = 'test-password-123'

  beforeAll(async () => {
    await resetBusinessData(pool)
    await ensureTestUser(pool, ADMIN, PASSWORD, 'admin')
    customerId = await insertCustomer(pool, 'Settle Voucher Customer')
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
    await pool.query('DELETE FROM cheques')
    await pool.query('UPDATE accounts SET receivable = 0, payable = 0 WHERE id = $1', [customerId])
  })

  const settle = (extra: Record<string, unknown>) => ({
    customerId, amount: 10_000, method: 'Cash', bankId: '', chqNo: '', chqBank: '', ...extra,
  })

  async function legs() {
    const { rows } = await pool.query(
      `SELECT debit_account, credit_account, amount::float8 AS amount, txn_date, activity_id, cheque_id, narration
       FROM journal_entries WHERE voucher_id IS NOT NULL ORDER BY amount DESC`,
    )
    return rows as any[]
  }
  const owe = async (col: 'receivable' | 'payable') =>
    Number((await pool.query(`SELECT ${col}::float8 AS v FROM accounts WHERE id = $1`, [customerId])).rows[0].v)

  // --- receipts -----------------------------------------------------------

  it('a cash receipt debits cash and credits the customer', async () => {
    await pool.query('UPDATE accounts SET receivable = 50000 WHERE id = $1', [customerId])
    expect((await admin.post('/api/settlements/receive', settle({}))).status).toBe(200)

    const rows = await legs()
    expect(rows).toHaveLength(1)
    expect(rows[0].debit_account).toBe('cash')
    expect(rows[0].credit_account).toBe(customerId)
    expect(rows[0].amount).toBe(10_000)
    expect(await owe('receivable')).toBe(40_000)
  })

  it('a receipt taken by cheque posts no voucher, matching the balance staying put', async () => {
    await pool.query('UPDATE accounts SET receivable = 50000 WHERE id = $1', [customerId])
    expect((await admin.post('/api/settlements/receive', settle({ method: 'Cheque', chqNo: 'C-9', chqBank: 'Meezan' }))).status).toBe(200)

    expect(await owe('receivable'), 'the balance does not move until the cheque clears').toBe(50_000)
    expect(await legs(), 'so nothing is posted either').toHaveLength(0)

    const { rows: act } = await pool.query("SELECT 1 FROM activity WHERE type = 'receive'")
    expect(act, 'the receipt is still recorded').toHaveLength(1)
  })

  // --- 'Credit' is not a settlement method — AUDIT.md §3 #8 --------------
  //
  // A receipt or payment records money actually changing hands: cash in the drawer, a bank
  // transfer, or a cheque. 'Credit' is a TRADE's way of saying "nothing settled, it is all on
  // account" — it has no cash-side account at all. Fed to receive/pay it used to be accepted: the
  // customer's balance dropped, settlementIdFor returned null, buildVoucherLegs returned null on
  // the accountless cash side, and no voucher was written. Money recorded as received with
  // nothing receiving it, the shortfall absorbed silently by the balance sheet's equity plug.
  // The UI never offered it (Settle.tsx's METHODS excludes it); only a hand-built API call could
  // reach it, and any signed-in user could.

  it('rejects a receipt with method Credit — no balance move, no activity row, nothing posted', async () => {
    await pool.query('UPDATE accounts SET receivable = 50000 WHERE id = $1', [customerId])

    const res = await admin.post('/api/settlements/receive', settle({ method: 'Credit' }))
    expect(res.status, JSON.stringify(res.json)).toBe(400)
    expect(res.json.error).toMatch(/cash, bank or cheque/i)

    expect(await owe('receivable'), 'the receivable must not have moved').toBe(50_000)
    expect(await legs(), 'and no voucher is posted').toHaveLength(0)
    const { rows: act } = await pool.query("SELECT 1 FROM activity WHERE type = 'receive'")
    expect(act, 'not even the activity row is written').toHaveLength(0)
  })

  it('rejects a payment with method Credit on the same terms', async () => {
    await pool.query('UPDATE accounts SET payable = 50000 WHERE id = $1', [customerId])

    const res = await admin.post('/api/settlements/pay', settle({ method: 'Credit' }))
    expect(res.status, JSON.stringify(res.json)).toBe(400)
    expect(res.json.error).toMatch(/cash, bank or cheque/i)

    expect(await owe('payable'), 'the payable must not have moved').toBe(50_000)
    expect(await legs(), 'and no voucher is posted').toHaveLength(0)
    const { rows: act } = await pool.query("SELECT 1 FROM activity WHERE type = 'pay'")
    expect(act, 'not even the activity row is written').toHaveLength(0)
  })

  // --- payments -----------------------------------------------------------

  it('a cash payment debits the customer and credits cash', async () => {
    await pool.query('UPDATE accounts SET payable = 50000 WHERE id = $1', [customerId])
    expect((await admin.post('/api/settlements/pay', settle({}))).status).toBe(200)

    const rows = await legs()
    expect(rows).toHaveLength(1)
    expect(rows[0].debit_account).toBe(customerId)
    expect(rows[0].credit_account).toBe('cash')
    expect(await owe('payable')).toBe(40_000)
  })

  it('copies the transaction date, so a backdated settlement is not split across periods', async () => {
    await pool.query('UPDATE accounts SET receivable = 50000 WHERE id = $1', [customerId])
    expect((await admin.post('/api/settlements/receive', settle({ txnDate: '2026-06-11' }))).status).toBe(200)

    const rows = await legs()
    expect(rows[0].txn_date).toBe('2026-06-11')
  })

  it('links settlement legs to their activity row', async () => {
    await pool.query('UPDATE accounts SET receivable = 50000 WHERE id = $1', [customerId])
    expect((await admin.post('/api/settlements/receive', settle({}))).status).toBe(200)

    const { rows: act } = await pool.query<{ id: string }>('SELECT id FROM activity LIMIT 1')
    expect((await legs())[0].activity_id).toBe(act[0].id)
  })

  // --- cheque clearing ----------------------------------------------------

  /** Takes a receipt by cheque and walks it to Deposited, ready to clear. */
  async function depositedInwardCheque(amount = 10_000): Promise<string> {
    await pool.query('UPDATE accounts SET receivable = 50000 WHERE id = $1', [customerId])
    expect((await admin.post('/api/settlements/receive', settle({ amount, method: 'Cheque', chqNo: 'C-1', chqBank: 'Meezan' }))).status).toBe(200)
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM cheques LIMIT 1')
    expect((await admin.post(`/api/cheques/${rows[0].id}/deposit`, {})).status).toBe(200)
    return rows[0].id
  }

  it('clearing an inward cheque debits the bank and credits the customer', async () => {
    const chequeId = await depositedInwardCheque()
    expect(await legs(), 'nothing posted up to this point').toHaveLength(0)

    expect((await admin.post(`/api/cheques/${chequeId}/clear`, {})).status).toBe(200)

    const rows = await legs()
    expect(rows).toHaveLength(1)
    expect(rows[0].credit_account).toBe(customerId)
    expect(rows[0].amount).toBe(10_000)
    expect(await owe('receivable'), 'and only now does the balance move').toBe(40_000)

    const { rows: bank } = await pool.query<{ id: string }>("SELECT id FROM accounts WHERE type = 'Bank' ORDER BY created_at LIMIT 1")
    expect(rows[0].debit_account).toBe(bank[0].id)
  })

  it('links the clearing voucher to its cheque, so a backfill can tell it already exists', async () => {
    // Migration 018's whole purpose. Without this, "does this cheque already have its voucher?" has
    // no key to ask on — clearing writes no activity row — and the phase 4 backfill could not be
    // safely re-run after a partial failure without giving cleared cheques a second voucher.
    const chequeId = await depositedInwardCheque()
    expect((await admin.post(`/api/cheques/${chequeId}/clear`, {})).status).toBe(200)

    const rows = await legs()
    expect(rows).toHaveLength(1)
    expect(rows[0].cheque_id).toBe(chequeId)
  })

  it('sets cheque_id only on clearing vouchers, never on a settlement voucher', async () => {
    // A leg carries activity_id or cheque_id, never both and never the wrong one — otherwise the
    // backfill's two EXISTS checks would each match records belonging to the other.
    await pool.query('UPDATE accounts SET receivable = 50000 WHERE id = $1', [customerId])
    expect((await admin.post('/api/settlements/receive', settle({}))).status).toBe(200)

    const rows = await legs()
    expect(rows[0].cheque_id).toBeNull()
    expect(rows[0].activity_id).not.toBeNull()
  })

  it('carries no activity link, because clearing writes no activity row', async () => {
    // The case that made VoucherInput.activityId nullable. A cheque transition is not a deal, and
    // borrowing the originating trade's row would attach it to a different event on a different day.
    const chequeId = await depositedInwardCheque()
    expect((await admin.post(`/api/cheques/${chequeId}/clear`, {})).status).toBe(200)

    const rows = await legs()
    expect(rows[0].activity_id).toBeNull()
  })

  it('dates the clearing voucher the day it cleared, not the day the cheque was taken', async () => {
    const chequeId = await depositedInwardCheque()
    // The receipt itself was backdated by the fixture only implicitly; what matters is that the
    // clearing voucher takes the clearing date, which is what ledgerBalance() counts it on.
    expect((await admin.post(`/api/cheques/${chequeId}/clear`, {})).status).toBe(200)

    // The desk's day, not the database session's — see config/deskTime.ts.
    expect((await legs())[0].txn_date).toBe(deskToday())
  })

  it('posts nothing when a deposited cheque is returned instead of cleared', async () => {
    const chequeId = await depositedInwardCheque()
    expect((await admin.post(`/api/cheques/${chequeId}/return`, {})).status).toBe(200)

    expect(await legs(), 'a returned cheque never moved money').toHaveLength(0)
    expect(await owe('receivable')).toBe(50_000)
  })

  it('posts nothing on deposit, which is a status change only', async () => {
    await depositedInwardCheque()
    expect(await legs()).toHaveLength(0)
  })
})
