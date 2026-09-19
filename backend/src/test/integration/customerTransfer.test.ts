import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { truncateAndReseedTestDb, ensureTestUser, insertCustomer } from '../dbFixtures.js'

// A customer-to-customer transfer — the desk calls it a JV.
//
// Customer A says "take 10 lac out of my account and give it to B", and B wants it on his running
// balance rather than paid out. No money touches a Bank or Cash account: A's ledger balance is
// debited and B's is credited.
//
// THE POSTING ITSELF IS NOT NEW. postJournal has always moved both customers' balances, and
// journalCustomerBalance.test.ts already pins the allocation rule including the two-customer case.
// What is new is the Settle screen's way in, and the two ACCESS decisions it rests on — which is
// what this file covers, because nothing pinned either of them before:
//
//   1. Only an Admin can create one. The Settle screen hides the control from an Operator; that is
//      only honest if the server refuses as well, otherwise the gate is decoration.
//   2. Everyone can SEE one once posted. A transfer carries no Income leg, so mapJournalRow must
//      not withhold it — an Operator looking at the customer's history has to see why the balance
//      moved. This is the deliberate complement of journalIncome.authorization.test.ts.
//
// Also covered: over-transferring is ALLOWED. The desk's running "kata" balance legitimately
// crosses from credit into debt, so the screen warns rather than blocks, and the server must not
// quietly disagree with that by refusing the post.
describe('customer-to-customer transfer (JV)', () => {
  let server: TestServer
  let admin: ApiClient
  let operator: ApiClient
  let fromId: string
  let toId: string

  const ADMIN = 'jv-admin@currencydesk.local'
  const OPERATOR = 'jv-operator@currencydesk.local'
  const PASSWORD = 'test-password-123'

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    await ensureTestUser(pool, ADMIN, PASSWORD, 'admin')
    await ensureTestUser(pool, OPERATOR, PASSWORD, 'user')
    fromId = await insertCustomer(pool, 'Transfer From')
    toId = await insertCustomer(pool, 'Transfer To')
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
    await pool.query('UPDATE accounts SET receivable = 0, payable = 0')
  })

  const set = (id: string, recv: number, pay: number) =>
    pool.query('UPDATE accounts SET receivable = $2, payable = $3 WHERE id = $1', [id, recv, pay])

  const balance = async (id: string) => {
    const { rows } = await pool.query<{ r: number; p: number }>(
      'SELECT receivable::float8 AS r, payable::float8 AS p FROM accounts WHERE id = $1',
      [id],
    )
    return { receivable: rows[0].r, payable: rows[0].p, net: rows[0].r - rows[0].p }
  }

  /** Exactly what Settle.tsx sends: Dr the customer named at the top, Cr the one receiving. */
  const transfer = (client: ApiClient, amount: number, txnDate?: string) =>
    client.post('/api/journal', {
      debitAccount: fromId,
      creditAccount: toId,
      debitAmount: amount,
      creditAmount: amount,
      narration: 'Transfer from Transfer From to Transfer To',
      ...(txnDate ? { txnDate } : {}),
    })

  // --- the case Ahmed described -------------------------------------------

  it('moves 10 lac out of one customer and into the other', async () => {
    // The desk owes A 15 lac; A asks for 10 lac of it to go to B, who keeps a running balance.
    await set(fromId, 0, 1_500_000)
    await set(toId, 0, 0)

    expect((await transfer(admin, 1_000_000)).status).toBe(200)

    const from = await balance(fromId)
    const to = await balance(toId)
    expect(from.payable, "A's claim on the desk drops by exactly the transfer").toBe(500_000)
    expect(from.receivable, 'nothing crosses over — 10 lac fits inside the 15').toBe(0)
    expect(to.payable, 'B is owed the 10 lac instead').toBe(1_000_000)
    expect(from.net + to.net, 'the desk owes the same in total as before').toBe(-1_500_000)
  })

  it('no bank or cash account is touched', async () => {
    // The whole point of a JV: it is not a settlement, so no money account moves and no activity
    // row exists. A regression that routed this through the settlement path would show up here.
    await set(fromId, 0, 1_000_000)
    expect((await transfer(admin, 400_000)).status).toBe(200)

    const { rows: acts } = await pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM activity')
    expect(Number(acts[0].n), 'a transfer writes no activity row').toBe(0)

    const { rows: money } = await pool.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM journal_entries WHERE debit_account IN ('bank','cash') OR credit_account IN ('bank','cash')",
    )
    expect(Number(money[0].n), 'neither leg touches a money account').toBe(0)
  })

  // --- over-transfer is allowed, not blocked -------------------------------

  it('allows a transfer larger than the balance, leaving the customer owing the desk', async () => {
    // The screen warns about this; it must not be a server-side refusal, or the warning would be
    // a lie and the operation unreachable. A kata balance crossing into debt is ordinary.
    await set(fromId, 0, 200_000)
    await set(toId, 0, 0)

    expect((await transfer(admin, 500_000)).status).toBe(200)

    const from = await balance(fromId)
    expect(from.payable, 'what the desk owed is cleared').toBe(0)
    expect(from.receivable, 'the excess crosses over into what they owe').toBe(300_000)
    expect((await balance(toId)).payable, 'the receiving side is unaffected by the shortfall').toBe(500_000)
  })

  it('refuses a transfer to the same customer, and writes nothing', async () => {
    // A self-transfer nets to zero but would still leave a journal entry behind, which is a
    // confusing artefact at best. The Settle screen excludes the chosen customer from the
    // "Transfer to" list AND checks again before review, but neither is the guard that matters:
    // postJournal refuses outright, so the API cannot be talked into one either.
    await set(fromId, 0, 1_000_000)
    const res = await admin.post('/api/journal', {
      debitAccount: fromId,
      creditAccount: fromId,
      debitAmount: 1_000,
      creditAmount: 1_000,
      narration: 'self',
    })
    expect(res.status).toBe(400)

    const { rows } = await pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM journal_entries')
    expect(Number(rows[0].n), 'no entry left behind by the refusal').toBe(0)
    expect((await balance(fromId)).payable, 'and no balance moved').toBe(1_000_000)
  })

  // --- amount validation, server-side --------------------------------------
  //
  // The screen blocks these too, but a disabled button is not a guard: this is money moving on
  // the books, so the refusal has to hold against the API directly. Nothing pinned this before —
  // the layers existed (parseAmount, postJournal's own check, and a CHECK (amount > 0) on the
  // column) but no test held any of them.

  it.each([
    ['zero', 0],
    ['negative', -500_000],
  ])('refuses a %s amount, and moves nothing', async (_label, amount) => {
    await set(fromId, 0, 1_000_000)
    await set(toId, 0, 0)

    const res = await transfer(admin, amount as number)
    expect(res.status).toBe(400)

    const { rows } = await pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM journal_entries')
    expect(Number(rows[0].n), 'nothing posted').toBe(0)
    expect((await balance(fromId)).payable, 'the sending side is untouched').toBe(1_000_000)
    expect((await balance(toId)).payable, 'the receiving side is untouched').toBe(0)
  })

  it('refuses an amount that is not a number', async () => {
    await set(fromId, 0, 1_000_000)
    const res = await admin.post('/api/journal', {
      debitAccount: fromId,
      creditAccount: toId,
      debitAmount: 'not-a-number',
      creditAmount: 'not-a-number',
      narration: 'rubbish',
    })
    expect(res.status).toBe(400)
    expect((await balance(fromId)).payable).toBe(1_000_000)
  })

  it('refuses an out-of-balance entry where the two sides disagree', async () => {
    // Settle always sends one figure for both sides, so this cannot arise from the screen — which
    // is exactly why it is worth pinning at the API, where it can.
    await set(fromId, 0, 1_000_000)
    const res = await admin.post('/api/journal', {
      debitAccount: fromId,
      creditAccount: toId,
      debitAmount: 500_000,
      creditAmount: 400_000,
      narration: 'lopsided',
    })
    expect(res.status).toBe(400)
    expect((await balance(fromId)).payable).toBe(1_000_000)
  })

  // --- audit trail ---------------------------------------------------------

  it('records which admin posted the transfer, on the entry itself', async () => {
    // A JV bypasses Bank and Cash entirely, so this journal entry is the ONLY record that the
    // transfer happened and the only record of who authorised it. It is stored on the row, not in
    // a separate audit log, and served on the entry as `createdBy`.
    await set(fromId, 0, 1_000_000)
    expect((await transfer(admin, 300_000)).status).toBe(200)

    const { rows } = await pool.query<{ created_by: string | null; email: string | null }>(
      `SELECT j.created_by, u.email FROM journal_entries j LEFT JOIN users u ON u.id = j.created_by`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].created_by, 'the posting user is stamped on the row').not.toBeNull()
    expect(rows[0].email, 'and resolves to the admin who posted it').toBe(ADMIN)

    const res = await admin.get('/api/state')
    const entries = JSON.parse(JSON.stringify((res.json as { journalEntries: unknown }).journalEntries)) as {
      createdBy: string
      createdAt: string
    }[]
    expect(entries).toHaveLength(1)
    expect(entries[0].createdBy, 'and is served on the entry, not hidden behind a separate lookup').toBeTruthy()
    expect(entries[0].createdAt).toBeTruthy()
  })

  // --- access -------------------------------------------------------------

  it('refuses to create one for an Operator', async () => {
    await set(fromId, 0, 1_000_000)
    const res = await transfer(operator, 100_000)
    expect(res.status, 'POST /api/journal is admin-only — the UI gate must not be the only one').toBe(403)

    const { rows } = await pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM journal_entries')
    expect(Number(rows[0].n), 'nothing posted').toBe(0)
    expect((await balance(fromId)).payable, 'no balance moved either').toBe(1_000_000)
  })

  it('shows the posted transfer to an Operator', async () => {
    // The complement of the Income rule: a transfer discloses no margin, so withholding it would
    // leave an Operator looking at a balance that moved for no visible reason.
    await set(fromId, 0, 1_000_000)
    expect((await transfer(admin, 250_000)).status).toBe(200)

    const res = await operator.get('/api/state')
    expect(res.status).toBe(200)
    const rows = JSON.parse(JSON.stringify((res.json as { journalEntries: unknown }).journalEntries)) as {
      debitAccount: string
      creditAccount: string
      amount: number
    }[]
    const mine = rows.filter((e) => e.debitAccount === fromId && e.creditAccount === toId)
    expect(mine, 'an Operator should see the transfer').toHaveLength(1)
    expect(mine[0].amount).toBe(250_000)
  })

  // --- the date -----------------------------------------------------------

  it('records the transfer on the date given, not the day it was keyed in', async () => {
    // Settle has a date picker and sends it; a transfer agreed last Thursday belongs in last
    // Thursday's figures. The route has always accepted txnDate — the Journal page just never
    // sent one, so nothing exercised it from a real client's payload shape.
    await set(fromId, 0, 1_000_000)
    expect((await transfer(admin, 50_000, '2026-09-14')).status).toBe(200)

    const { rows } = await pool.query<{ txn_date: string }>('SELECT txn_date FROM journal_entries')
    expect(rows).toHaveLength(1)
    expect(rows[0].txn_date).toBe('2026-09-14')
  })
})
