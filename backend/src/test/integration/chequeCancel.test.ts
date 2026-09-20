import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { truncateAndReseedTestDb, ensureTestUser, insertCustomer } from '../dbFixtures.js'

// Cancelling a cheque entered by mistake, and the dealer-set due date.
//
// Before this, a mis-entered cheque had no way off the uncleared list except Deposited -> Returned,
// which writes a history saying it went to the bank and bounced — two events that never happened,
// on a record the client shows customers.
describe('cancelling a cheque, and the due date', () => {
  let server: TestServer
  let admin: ApiClient
  let operator: ApiClient
  let customerId: string

  const ADMIN = 'chq-cancel@currencydesk.local'
  const OPERATOR = 'chq-cancel-op@currencydesk.local'
  const PASSWORD = 'test-password-123'

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    await ensureTestUser(pool, ADMIN, PASSWORD, 'admin')
    await ensureTestUser(pool, OPERATOR, PASSWORD, 'user')
    customerId = await insertCustomer(pool, 'Cancel Customer')
    server = await startTestServer()
    admin = new ApiClient(server.baseUrl)
    operator = new ApiClient(server.baseUrl)
    expect((await admin.login(ADMIN, PASSWORD)).status).toBe(200)
    expect((await operator.login(OPERATOR, PASSWORD)).status).toBe(200)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM journal_entries')
    await pool.query('DELETE FROM activity')
    await pool.query('DELETE FROM cheques')
    await pool.query('UPDATE accounts SET receivable = 0, payable = 0')
  })

  const balance = async () => {
    const { rows } = await pool.query<{ r: number; p: number }>(
      'SELECT receivable::float8 AS r, payable::float8 AS p FROM accounts WHERE id = $1',
      [customerId],
    )
    return { receivable: rows[0].r, payable: rows[0].p }
  }

  const chequeRow = async (id: string) => {
    const { rows } = await pool.query<{ status: string; history: string[]; due_date: string; updated_by: string | null }>(
      'SELECT status, history, due_date, updated_by FROM cheques WHERE id = $1',
      [id],
    )
    return rows[0]
  }

  /** Records a cheque the way the app does — through Receive Payment with method Cheque. */
  const receiveByCheque = async (amount: number, extra: Record<string, unknown> = {}) => {
    await pool.query('UPDATE accounts SET receivable = $2 WHERE id = $1', [customerId, amount])
    const res = await admin.post('/api/settlements/receive', {
      customerId,
      amount,
      method: 'Cheque',
      bankId: 'bank',
      chqNo: '',
      chqBank: 'HBL',
      ...extra,
    })
    expect(res.status).toBe(200)
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM cheques ORDER BY created_at DESC LIMIT 1')
    return rows[0].id
  }

  // --- cancelling ----------------------------------------------------------

  it('cancels a pending cheque and records who did it, without touching the balance', async () => {
    const id = await receiveByCheque(50_000)
    expect((await balance()).receivable, 'a held cheque never moved the balance').toBe(50_000)

    expect((await admin.post(`/api/cheques/${id}/cancel`)).status).toBe(200)

    const q = await chequeRow(id)
    expect(q.status).toBe('Cancelled')
    expect(q.history.at(-1), 'the history says cancelled, not deposited-then-returned').toMatch(/^Cancelled /)
    expect(q.history.some((h) => /Deposited|Returned/.test(h)), 'no invented trip to the bank').toBe(false)
    expect(q.updated_by, 'who cancelled it is on the row').not.toBeNull()

    expect((await balance()).receivable, 'the debt is untouched — the cheque never existed').toBe(50_000)
  })

  it('refuses to cancel once the cheque has been deposited', async () => {
    // From here the cheque is with the bank and its outcome is Cleared or Returned.
    const id = await receiveByCheque(50_000)
    expect((await admin.post(`/api/cheques/${id}/deposit`)).status).toBe(200)

    const res = await admin.post(`/api/cheques/${id}/cancel`)
    expect(res.status).toBe(409)
    expect((await chequeRow(id)).status).toBe('Deposited')
  })

  it('refuses to cancel a cleared cheque, which has already moved money', async () => {
    const id = await receiveByCheque(50_000)
    expect((await admin.post(`/api/cheques/${id}/deposit`)).status).toBe(200)
    expect((await admin.post(`/api/cheques/${id}/clear`)).status).toBe(200)

    expect((await admin.post(`/api/cheques/${id}/cancel`)).status).toBe(409)
    expect((await chequeRow(id)).status).toBe('Cleared')
    expect((await balance()).receivable, 'and the cleared amount stays applied').toBe(0)
  })

  it('refuses a second cancel', async () => {
    const id = await receiveByCheque(50_000)
    expect((await admin.post(`/api/cheques/${id}/cancel`)).status).toBe(200)
    expect((await admin.post(`/api/cheques/${id}/cancel`)).status).toBe(409)
    expect((await chequeRow(id)).history.filter((h) => h.startsWith('Cancelled')), 'one history line, not two').toHaveLength(1)
  })

  it('is admin-only', async () => {
    const id = await receiveByCheque(50_000)
    expect((await operator.post(`/api/cheques/${id}/cancel`)).status).toBe(403)
    expect((await chequeRow(id)).status).toBe('Pending')
  })

  // --- the due date --------------------------------------------------------

  it('stores the due date the dealer entered', async () => {
    const id = await receiveByCheque(50_000, { chqDue: '2026-12-25' })
    expect((await chequeRow(id)).due_date).toBe('2026-12-25')
  })

  it('accepts a due date in the future, which parseTxnDate would reject', async () => {
    // The one date on the desk that is SUPPOSED to point forward — a cheque is normally
    // post-dated. Reusing the transaction-date validator here would refuse the ordinary case.
    const id = await receiveByCheque(50_000, { chqDue: '2030-01-01' })
    expect((await chequeRow(id)).due_date).toBe('2030-01-01')
  })

  it('falls back to the default when no due date is sent', async () => {
    // Fourteen days out, which is what the server imposed unconditionally before the field existed.
    const id = await receiveByCheque(50_000)
    const due = (await chequeRow(id)).due_date
    const expected = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
    expect(due).toBe(expected)
  })

  it('still rejects a malformed or impossible due date', async () => {
    await pool.query('UPDATE accounts SET receivable = 50000 WHERE id = $1', [customerId])
    for (const bad of ['25-12-2026', '2026-02-30', 'next Tuesday']) {
      const res = await admin.post('/api/settlements/receive', {
        customerId, amount: 50_000, method: 'Cheque', bankId: 'bank', chqNo: '', chqBank: 'HBL', chqDue: bad,
      })
      expect(res.status, bad).toBe(400)
    }
    const { rows } = await pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM cheques')
    expect(Number(rows[0].n), 'nothing was recorded').toBe(0)
  })
})
