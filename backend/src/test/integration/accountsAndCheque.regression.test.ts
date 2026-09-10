import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { truncateAndReseedTestDb, ensureTestUser, insertCustomer } from '../dbFixtures.js'

// Two defects found by the QA pass on the multi-currency change. Neither is a rate-conversion
// bug and neither showed up as a failing test — one returned a raw 500, the other a cheerful
// 200 that silently corrupted the Balance Sheet. Both are pinned here.
describe('regressions: cheque bank account, and Currency Stock code integrity', () => {
  let server: TestServer
  let client: ApiClient
  let customerId: string

  const form = (over: Record<string, unknown> = {}) => ({
    type: 'Currency Stock',
    name: 'Some stock account',
    phone: '', city: '', notes: '', bankName: '', accountNo: '',
    category: '', designation: '', monthlySalary: '', code: 'AED',
    opening: '', typeOverride: false,
    ...over,
  })

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    await ensureTestUser(pool, 'regression@currencydesk.local', 'test-password-123', 'admin')
    customerId = await insertCustomer(pool, 'Regression Supplier')
    server = await startTestServer()
    client = new ApiClient(server.baseUrl)
    expect((await client.login('regression@currencydesk.local', 'test-password-123')).status).toBe(200)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  // settlementIdFor() resolves a blank bankId to the default bank account, but the two cheque
  // call sites in tradesService passed the RAW input.bankId to insertCheque instead — '' is not
  // a valid accounts.id, so cheques.bank_account_id's FK rejected it and the global error
  // handler turned that into a 500. settlementsService.ts had already been fixed for exactly
  // this; trades.ts was missed. Not reachable from today's UI (every trade posts Credit), but
  // it is live API surface and it is what un-hiding the settlement picker would restore.
  it('a Cheque-method purchase with a blank bankId resolves the default bank instead of 500ing', async () => {
    const res = await client.post('/api/trades/purchase', {
      customerId, currency: 'AED', amount: 100, rate: 77,
      method: 'Cheque', paidNow: 60, bankId: '', chqNo: '', chqBank: 'Meezan',
    })
    expect(res.status).toBe(200)

    const { rows } = await pool.query(
      "SELECT c.bank_account_id, a.type FROM cheques c JOIN accounts a ON a.id = c.bank_account_id WHERE c.bank = 'Meezan'",
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('Bank')
    expect(rows[0].bank_account_id).toBeTruthy()
  })

  // A Currency Stock account is just the Balance Sheet's view of one stock_positions row, joined
  // by `code`. A second account with the same code values the SAME position again, so the sheet
  // double-counts the stock and the capital plug absorbs the difference — still reporting
  // balanced=true. The modal defaulting the field to 'AED' made this a realistic slip.
  it('rejects a second Currency Stock account for an already-tracked currency', async () => {
    const res = await client.post('/api/accounts', form({ name: 'Dirham vault (branch 2)', code: 'AED' }))
    expect(res.status).toBe(409)
    expect(String(res.json?.error)).toMatch(/already exists/i)

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM accounts WHERE type = 'Currency Stock' AND upper(code) = 'AED'")
    expect(rows[0].n).toBe(1)
  })

  it('rejects a Currency Stock account for a currency this desk does not trade', async () => {
    const res = await client.post('/api/accounts', form({ name: 'Franc vault', code: 'CHF' }))
    expect(res.status).toBe(400)
    expect(String(res.json?.error)).toMatch(/this desk trades/i)
  })

  // Case-only variants were previously accepted and rendered a permanent zero-valued row,
  // because stk() looks the position up by exact code.
  it('normalises case rather than accepting a duplicate under a different casing', async () => {
    const res = await client.post('/api/accounts', form({ name: 'Lowercase vault', code: 'aed' }))
    expect(res.status).toBe(409)
  })
})
