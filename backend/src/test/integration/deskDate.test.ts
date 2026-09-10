import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { truncateAndReseedTestDb, ensureTestUser, insertCustomer } from '../dbFixtures.js'

// Every record the server dates on its own — AUDIT.md §3 #2.
//
// A trade or settlement posted without a txnDate, a manual journal entry (which never had one), and
// the voucher written when a cheque clears all took their date from the DATABASE's clock, via
// CURRENT_DATE or updated_at::date. Neon's session timezone is UTC, so between midnight and 05:00
// on the desk's clock all of them were dated yesterday.
//
// These tests freeze ONLY the JavaScript Date (timers, HTTP and Postgres run for real) at 02:30 on
// the desk's morning and drive the real server over real HTTP. Before the fix, every stored date
// below is the database's real today rather than the frozen desk day, so each assertion fails.

/** 2026-04-01 02:30 in Karachi, which is still 2026-03-31 21:30 in UTC. */
const DESK_EARLY_MORNING = new Date('2026-03-31T21:30:00.000Z')
const DESK_TODAY = '2026-04-01'

describe('records the server dates itself land on the desk\'s day', () => {
  let server: TestServer
  let admin: ApiClient
  let customerId: string

  const ADMIN = 'deskdate-admin@currencydesk.local'
  const PASSWORD = 'test-password-123'

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    await ensureTestUser(pool, ADMIN, PASSWORD, 'admin')
    customerId = await insertCustomer(pool, 'Desk Date Customer', { receivable: 50_000 })
    server = await startTestServer()
    admin = new ApiClient(server.baseUrl)
    // Signed in on the real clock, THEN the clock is frozen: the session cookie's own expiry is
    // computed from Date, and freezing first would mint a cookie that is already stale.
    expect((await admin.login(ADMIN, PASSWORD)).status).toBe(200)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(DESK_EARLY_MORNING)
  })

  afterAll(async () => {
    vi.useRealTimers()
    await server.close()
    await pool.end()
  })

  it('a purchase posted with no txnDate is dated the desk\'s today', async () => {
    const res = await admin.post('/api/trades/purchase', {
      customerId,
      currency: 'AED',
      amount: 100,
      rate: 78,
      method: 'Credit',
      paidNow: 0,
      bankId: '',
      chqNo: '',
      chqBank: '',
    })
    expect(res.status, JSON.stringify(res.json)).toBe(200)
    const { rows } = await pool.query<{ txn_date: string }>("SELECT txn_date FROM activity WHERE type = 'purchase' ORDER BY created_at DESC LIMIT 1")
    expect(rows[0].txn_date).toBe(DESK_TODAY)
    // And its voucher copies the same day.
    const { rows: legs } = await pool.query<{ txn_date: string }>("SELECT txn_date FROM journal_entries WHERE activity_id = (SELECT id FROM activity WHERE type = 'purchase' ORDER BY created_at DESC LIMIT 1)")
    expect(legs.length).toBeGreaterThan(0)
    for (const leg of legs) expect(leg.txn_date).toBe(DESK_TODAY)
  })

  it('a purchase posted WITH the desk\'s today as txnDate is accepted, not refused as future', async () => {
    const res = await admin.post('/api/trades/purchase', {
      customerId,
      currency: 'USD',
      amount: 10,
      rate: 280,
      method: 'Credit',
      paidNow: 0,
      bankId: '',
      chqNo: '',
      chqBank: '',
      txnDate: DESK_TODAY,
    })
    expect(res.status, JSON.stringify(res.json)).toBe(200)
  })

  it('a receipt posted with no txnDate is dated the desk\'s today', async () => {
    const res = await admin.post('/api/settlements/receive', { customerId, amount: 1_000, method: 'Cash', bankId: '', chqNo: '', chqBank: '' })
    expect(res.status, JSON.stringify(res.json)).toBe(200)
    const { rows } = await pool.query<{ txn_date: string }>("SELECT txn_date FROM activity WHERE type = 'receive' ORDER BY created_at DESC LIMIT 1")
    expect(rows[0].txn_date).toBe(DESK_TODAY)
  })

  it('a manual journal entry is dated the desk\'s today', async () => {
    const res = await admin.post('/api/journal', {
      debitAccount: 'expense',
      creditAccount: 'cash',
      debitAmount: 250,
      creditAmount: 250,
      narration: 'Early morning sundries',
    })
    expect(res.status, JSON.stringify(res.json)).toBe(200)
    const { rows } = await pool.query<{ txn_date: string }>("SELECT txn_date FROM journal_entries WHERE narration = 'Early morning sundries'")
    expect(rows[0].txn_date).toBe(DESK_TODAY)
  })

  it('a manual journal entry can carry an explicit txnDate, validated like a trade\'s', async () => {
    const ok = await admin.post('/api/journal', {
      debitAccount: 'expense',
      creditAccount: 'cash',
      debitAmount: 300,
      creditAmount: 300,
      narration: 'Backdated rent',
      txnDate: '2026-03-15',
    })
    expect(ok.status, JSON.stringify(ok.json)).toBe(200)
    const { rows } = await pool.query<{ txn_date: string }>("SELECT txn_date FROM journal_entries WHERE narration = 'Backdated rent'")
    expect(rows[0].txn_date).toBe('2026-03-15')

    const future = await admin.post('/api/journal', {
      debitAccount: 'expense',
      creditAccount: 'cash',
      debitAmount: 300,
      creditAmount: 300,
      narration: 'Tomorrow',
      txnDate: '2026-04-02',
    })
    expect(future.status).toBe(400)
    expect(future.json.error).toMatch(/cannot be in the future/)
  })

  it('a cheque cleared at 02:30 local is journalled on the desk\'s day, and its history says so', async () => {
    const taken = await admin.post('/api/settlements/receive', { customerId, amount: 5_000, method: 'Cheque', bankId: '', chqNo: 'DD-1', chqBank: 'Meezan' })
    expect(taken.status, JSON.stringify(taken.json)).toBe(200)
    const { rows: cheque } = await pool.query<{ id: string; due_date: string }>("SELECT id, due_date FROM cheques WHERE number = 'DD-1'")
    expect((await admin.post(`/api/cheques/${cheque[0].id}/deposit`)).status).toBe(200)
    expect((await admin.post(`/api/cheques/${cheque[0].id}/clear`)).status).toBe(200)

    const { rows: legs } = await pool.query<{ txn_date: string }>('SELECT txn_date FROM journal_entries WHERE cheque_id = $1', [cheque[0].id])
    expect(legs.length).toBeGreaterThan(0)
    for (const leg of legs) expect(leg.txn_date).toBe(DESK_TODAY)

    // The due date is 14 days from the desk's today, and the history lines name the desk's day.
    expect(cheque[0].due_date).toBe('2026-04-15')
    const { rows: hist } = await pool.query<{ history: string[] }>('SELECT history FROM cheques WHERE id = $1', [cheque[0].id])
    expect(hist[0].history).toEqual(['Recorded Apr 1', 'Deposited Apr 1', 'Cleared Apr 1'])
  })
})
