import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { truncateAndReseedTestDb, ensureTestUser, insertCustomer } from '../dbFixtures.js'

describe('cheque auto-number collision + retry', () => {
  let server: TestServer
  let client: ApiClient
  let customerA: string
  let customerB: string

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    await ensureTestUser(pool, 'concurrency-cheques@currencydesk.local', 'test-password-123', 'admin')
    // Two different customers — receive() only locks the target customer's own account row, so
    // two DIFFERENT customers' receives never serialize against each other the way two sales of
    // the same currency would. That's what makes it possible to force a genuine collision here
    // instead of the requests being naturally serialized before either reaches insertCheque().
    customerA = await insertCustomer(pool, 'Cheque Race Customer A', { receivable: 100000 })
    customerB = await insertCustomer(pool, 'Cheque Race Customer B', { receivable: 100000 })

    server = await startTestServer()
    client = new ApiClient(server.baseUrl)
    const login = await client.login('concurrency-cheques@currencydesk.local', 'test-password-123')
    expect(login.status).toBe(200)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  it('forces a genuine 23505 on the shared auto-number and confirms the SAVEPOINT-protected retry recovers with a distinct number', async () => {
    // Prime the sequence so the next two draws are known values, then pre-insert a "blocker"
    // cheque at the LOWER of those two numbers. Both concurrent requests' existing-numbers read
    // happens before either commits, so both see the same blocker and — regardless of which one
    // actually draws the lower vs. higher seed — both independently compute the SAME next number
    // (whichever drew the blocked seed skips forward onto it; whichever drew the seed one above
    // lands there directly), forcing a genuine race on that one INSERT. This is the exact
    // technique used to force this collision by hand during Phase 2 closure (see CLAUDE.md).
    const { rows: seedRows } = await pool.query<{ n: string }>("SELECT nextval('cheque_number_seq')::text AS n")
    const primed = Number(seedRows[0].n)
    const blockerNumber = String(primed + 1)
    const collisionNumber = String(primed + 2)
    const retryNumber = String(primed + 3)

    await pool.query(
      `INSERT INTO cheques (direction, number, party, customer_id, bank, bank_account_id, amount, due_date, history, source)
       VALUES ('Inward', $1, 'Blocker', $2, 'HBL', 'bank', 1, CURRENT_DATE, ARRAY['Blocker'], 'test-fixture')`,
      [blockerNumber, customerA],
    )

    const clientA = client.withSameSession()
    const clientB = client.withSameSession()
    const baseInput = { method: 'Cheque', bankId: '', chqNo: '', chqBank: 'HBL' }

    const [resA, resB] = await Promise.all([
      clientA.post('/api/settlements/receive', { ...baseInput, customerId: customerA, amount: 5000 }),
      clientB.post('/api/settlements/receive', { ...baseInput, customerId: customerB, amount: 7000 }),
    ])

    // The retry is transparent to the caller — both HTTP requests succeed even though one of
    // them collided and had to recompute a fresh number server-side.
    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)

    const { rows: numbers } = await pool.query<{ number: string }>("SELECT number FROM cheques WHERE source = 'payment in' ORDER BY number")
    expect(numbers.map((r) => r.number)).toEqual([collisionNumber, retryNumber])

    const { rows: allNumbers } = await pool.query<{ number: string }>('SELECT number FROM cheques')
    // No duplicate numbers anywhere in the table — not just "the two we expected", the actual
    // full state of the table.
    expect(new Set(allNumbers.map((r) => r.number)).size).toBe(allNumbers.length)
  })
})
