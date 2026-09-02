import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { resetBusinessData, ensureTestUser } from '../dbFixtures.js'

// journal_entries.txn_date (migration 017) — the journal's counterpart to activity.txn_date.
//
// Its own column rather than a join through activity_id, because manual entries, opening balances,
// salary postings and future reversal vouchers all have no activity row to join to. These tests
// pin the two properties that matter before phase 3 starts writing vouchers against it: every
// entry has a date, and that date crosses the wire as a plain 'YYYY-MM-DD' string rather than a
// timestamp that a timezone could slide by a day.
describe('journal entries carry their own transaction date', () => {
  let server: TestServer
  let admin: ApiClient

  const ADMIN = 'jtxn-admin@currencydesk.local'
  const PASSWORD = 'test-password-123'

  beforeAll(async () => {
    await resetBusinessData(pool)
    await ensureTestUser(pool, ADMIN, PASSWORD, 'admin')
    server = await startTestServer()
    admin = new ApiClient(server.baseUrl)
    expect((await admin.login(ADMIN, PASSWORD)).status).toBe(200)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  const post = () =>
    admin.post('/api/journal', {
      debitAccount: 'expense',
      creditAccount: 'cash',
      debitAmount: 500,
      creditAmount: 500,
      narration: 'Counter sundries',
    })

  it('defaults a manual entry to today, with no activity row to derive it from', async () => {
    expect((await post()).status).toBe(200)

    const res = await admin.get('/api/state')
    const entry = (res.json as any).journalEntries.find((e: any) => e.narration === 'Counter sundries')
    expect(entry, 'the entry should be in the snapshot').toBeTruthy()
    expect(entry.activityId, 'a manual entry has no activity row — the exact case a join would have missed').toBeUndefined()

    // CURRENT_DATE in the database session's timezone, which is the desk's own day.
    const { rows } = await pool.query<{ today: string }>('SELECT CURRENT_DATE::text AS today')
    expect(entry.txnDate).toBe(rows[0].today)
  })

  it('crosses the wire as a plain YYYY-MM-DD string, not a timestamp', async () => {
    // The DATE type parser in db/pool.ts returns literal text precisely so no Date object is ever
    // constructed and no timezone can shift the day. A regression here reads as an off-by-one-day
    // in every report cut on this column.
    const res = await admin.get('/api/state')
    const wire = JSON.parse(JSON.stringify((res.json as any).journalEntries))
    for (const e of wire) {
      expect(e.txnDate, `entry ${e.ref} should carry a date`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(e.txnDate).not.toContain('T')
    }
  })

  it('backfilled every pre-existing entry rather than leaving nulls', async () => {
    // The migration adds the column nullable, backfills from created_at, and only then sets NOT
    // NULL — migration 012's ordering, so a populated table never transiently holds a wrong value.
    const { rows } = await pool.query<{ nulls: number }>(
      'SELECT COUNT(*)::int AS nulls FROM journal_entries WHERE txn_date IS NULL',
    )
    expect(rows[0].nulls).toBe(0)
  })

  it('is NOT NULL at the database level, so a voucher cannot be posted without one', async () => {
    const { rows } = await pool.query<{ is_nullable: string; column_default: string | null }>(
      "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'journal_entries' AND column_name = 'txn_date'",
    )
    expect(rows[0].is_nullable).toBe('NO')
    expect(rows[0].column_default).toContain('CURRENT_DATE')
  })
})
