import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { truncateAndReseedTestDb, ensureTestUser } from '../dbFixtures.js'

// The sibling of stateMargin.authorization.test.ts, covering the hole requirement 7 would
// otherwise reopen.
//
// getSnapshot has stripped cost and margin from activity rows for non-admins since 2026-08-31,
// but journal entries were served to every role unfiltered — mapJournalRow took no view argument
// at all. That was harmless only because nothing posted profit to the journal. Requirement 7
// changes exactly that: a sale will credit the `margin` account with its realised profit, so the
// first commit that posts such a leg would hand every Operator the figure the API already
// declines to give them.
//
// These tests exist so the filter cannot be quietly removed later, and so the guarantee is
// asserted against the JSON that crossed the wire rather than an in-process object — the same
// reason the margin test does it that way.
describe('income disclosure on journal entries in the state snapshot', () => {
  let server: TestServer
  let admin: ApiClient
  let operator: ApiClient

  const ADMIN = 'journal-admin@currencydesk.local'
  const OPERATOR = 'journal-operator@currencydesk.local'
  const PASSWORD = 'test-password-123'

  const INCOME_AMOUNT = 12_345
  const EXPENSE_AMOUNT = 6_789

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    await ensureTestUser(pool, ADMIN, PASSWORD, 'admin')
    await ensureTestUser(pool, OPERATOR, PASSWORD, 'user')

    server = await startTestServer()

    admin = new ApiClient(server.baseUrl)
    expect((await admin.login(ADMIN, PASSWORD)).status).toBe(200)
    operator = new ApiClient(server.baseUrl)
    expect((await operator.login(OPERATOR, PASSWORD)).status).toBe(200)

    // Discloses income: 'margin' is the seeded Income account. This is the shape a requirement-7
    // sale voucher's second leg will take, posted here by hand because no code writes one yet.
    const income = await admin.post('/api/journal', {
      debitAccount: 'cash',
      creditAccount: 'margin',
      debitAmount: INCOME_AMOUNT,
      creditAmount: INCOME_AMOUNT,
      narration: 'Commission earned',
    })
    expect(income.status).toBe(200)

    // Discloses nothing about income. Present so the tests can tell a targeted filter apart from
    // one that simply withholds the whole journal from non-admins.
    const expense = await admin.post('/api/journal', {
      debitAccount: 'expense',
      creditAccount: 'cash',
      debitAmount: EXPENSE_AMOUNT,
      creditAmount: EXPENSE_AMOUNT,
      narration: 'Counter stationery',
    })
    expect(expense.status).toBe(200)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  const entries = (snapshot: any) => JSON.parse(JSON.stringify(snapshot.journalEntries)) as any[]
  const touching = (rows: any[], id: string) => rows.filter((e) => e.debitAccount === id || e.creditAccount === id)

  it('serves the Income-bearing entry to an Admin', async () => {
    const res = await admin.get('/api/state')
    expect(res.status).toBe(200)

    const income = touching(entries(res.json), 'margin')
    expect(income, 'the Admin should see the entry against Income').toHaveLength(1)
    expect(income[0].amount).toBe(INCOME_AMOUNT)
  })

  it('withholds the Income-bearing entry from an Operator entirely', async () => {
    const res = await operator.get('/api/state')
    expect(res.status).toBe(200)

    const rows = entries(res.json)
    expect(touching(rows, 'margin'), 'no entry against Income should reach an Operator').toHaveLength(0)

    // Omitted, not blanked. A row present with a zeroed or nulled amount would assert that the
    // desk earned nothing, which is a different and false claim — the same reasoning that governs
    // cost and margin on activity rows.
    const serialised = JSON.stringify(rows)
    expect(serialised).not.toContain(String(INCOME_AMOUNT))
    expect(serialised).not.toContain('Commission earned')
  })

  it('still serves an Operator the entries that disclose no income', async () => {
    const res = await operator.get('/api/state')
    const rows = entries(res.json)

    const expense = touching(rows, 'expense')
    expect(expense, 'a non-Income entry must survive the filter').toHaveLength(1)
    expect(expense[0].amount).toBe(EXPENSE_AMOUNT)
    expect(expense[0].narration).toBe('Counter stationery')
  })

  it('withholds entries against an Income account created after the seed', async () => {
    // The filter reads account types from the snapshot rather than hardcoding 'margin', because
    // an Admin can add further Income accounts and a filter that knew only the seeded one would
    // leak through every account added after it.
    const created = await admin.post('/api/accounts', {
      type: 'Income',
      name: 'Commission Income',
      phone: '', city: '', notes: '', bankName: '', accountNo: '',
      category: '', designation: '', monthlySalary: '', code: '', opening: '',
      typeOverride: false,
    })
    expect(created.status).toBe(200)

    const newIncomeId = (created.json as any).accounts.find((a: any) => a.name === 'Commission Income')?.id
    expect(newIncomeId, 'the new Income account should be in the snapshot').toBeTruthy()

    const posted = await admin.post('/api/journal', {
      debitAccount: 'cash',
      creditAccount: newIncomeId,
      debitAmount: 999,
      creditAmount: 999,
      narration: 'Brokerage on a referral',
    })
    expect(posted.status).toBe(200)

    const adminRows = entries((await admin.get('/api/state')).json)
    expect(touching(adminRows, newIncomeId)).toHaveLength(1)

    const operatorRows = entries((await operator.get('/api/state')).json)
    expect(touching(operatorRows, newIncomeId), 'a newly created Income account must be filtered too').toHaveLength(0)
  })
})
