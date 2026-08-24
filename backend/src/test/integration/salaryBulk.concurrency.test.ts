import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { resetBusinessData, ensureTestUser, insertEmployee } from '../dbFixtures.js'

// Covers the two bulk salary endpoints CLAUDE.md's Phase 2 verification explicitly disclosed as
// "not yet exercised" — accrueAllSalaries's per-row ON CONFLICT DO NOTHING batch tolerance, and
// payAllSalaries's fixed-lock-order concurrency guard. Not new behavior, just the coverage gap
// closed.
describe('bulk salary actions — accrueAllSalaries / payAllSalaries', () => {
  let server: TestServer
  let client: ApiClient

  beforeAll(async () => {
    server = await startTestServer()
    client = new ApiClient(server.baseUrl)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  beforeEach(async () => {
    await resetBusinessData(pool)
    await ensureTestUser(pool, 'concurrency-salary-bulk@currencydesk.local', 'test-password-123', 'admin')
    const login = await client.login('concurrency-salary-bulk@currencydesk.local', 'test-password-123')
    expect(login.status).toBe(200)
  })

  it('tolerates one already-accrued employee and still accrues the rest, instead of aborting the whole batch', async () => {
    const e1 = await insertEmployee(pool, 'Bulk Employee One', 1000)
    const e2 = await insertEmployee(pool, 'Bulk Employee Two', 2000)
    const e3 = await insertEmployee(pool, 'Bulk Employee Three', 3000)
    const period = '2026-08'

    const pre = await client.post('/api/salary/accrue', { employeeId: e1, period })
    expect(pre.status).toBe(200)

    const bulk = await client.post('/api/salary/accrue-all', { period })
    expect(bulk.status).toBe(200)

    const { rows } = await pool.query<{ salary_employee_id: string; n: number }>(
      "SELECT salary_employee_id, count(*)::int AS n FROM journal_entries WHERE salary_period = $1 AND salary_kind = 'accrual' GROUP BY salary_employee_id",
      [period],
    )
    const byEmployee = Object.fromEntries(rows.map((r) => [r.salary_employee_id, r.n]))
    // The pre-accrued employee is not double-accrued by the batch; the other two get exactly one
    // accrual each — a single unique-violation on e1 must not have aborted the whole loop.
    expect(byEmployee[e1]).toBe(1)
    expect(byEmployee[e2]).toBe(1)
    expect(byEmployee[e3]).toBe(1)
  })

  it('rejects accrue-all cleanly, not with a raw 500, once every employee is already accrued for the period', async () => {
    const e1 = await insertEmployee(pool, 'Bulk Employee One', 1000)
    const period = '2026-08'
    await client.post('/api/salary/accrue', { employeeId: e1, period })

    const bulk = await client.post('/api/salary/accrue-all', { period })
    expect(bulk.status).toBe(400)
    expect(bulk.json.error).toMatch(/already accrued/)
  })

  it('lets two concurrent accrue-all calls for the same period run without ever double-accruing an employee', async () => {
    const e1 = await insertEmployee(pool, 'Bulk Employee One', 1000)
    const e2 = await insertEmployee(pool, 'Bulk Employee Two', 2000)
    const period = '2026-08'

    const clientA = client.withSameSession()
    const clientB = client.withSameSession()
    const [resA, resB] = await Promise.all([clientA.post('/api/salary/accrue-all', { period }), clientB.post('/api/salary/accrue-all', { period })])

    // Unlike pay-all (below), accrue-all has no whole-set lock — it's plausible for the two
    // concurrent runs to split the two employees between them (both 200) or for one to win both
    // and the other lose both (200/400). Either split is fine; only a duplicate accrual isn't.
    for (const res of [resA, resB]) expect([200, 400]).toContain(res.status)

    const { rows } = await pool.query<{ salary_employee_id: string; n: number }>(
      "SELECT salary_employee_id, count(*)::int AS n FROM journal_entries WHERE salary_period = $1 AND salary_kind = 'accrual' GROUP BY salary_employee_id",
      [period],
    )
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.n).toBe(1)
  })

  it('pays every employee with an outstanding balance and skips those with none', async () => {
    const e1 = await insertEmployee(pool, 'Bulk Employee One', 1000)
    await insertEmployee(pool, 'Bulk Employee Two (no accrual)', 2000)
    const period = '2026-08'
    await client.post('/api/salary/accrue', { employeeId: e1, period })
    // e2 is deliberately left un-accrued — nothing outstanding for it to be paid.

    const res = await client.post('/api/salary/pay-all', { bankId: 'bank' })
    expect(res.status).toBe(200)

    const { rows } = await pool.query<{ salary_employee_id: string; amount: number }>("SELECT salary_employee_id, amount FROM journal_entries WHERE salary_kind = 'payment'")
    expect(rows).toHaveLength(1)
    expect(rows[0].salary_employee_id).toBe(e1)
    expect(rows[0].amount).toBe(1000)
  })

  it('rejects a second pay-all cleanly once nothing is outstanding, rather than double-paying', async () => {
    const e1 = await insertEmployee(pool, 'Bulk Employee One', 1000)
    const period = '2026-08'
    await client.post('/api/salary/accrue', { employeeId: e1, period })

    const first = await client.post('/api/salary/pay-all', { bankId: 'bank' })
    expect(first.status).toBe(200)

    const second = await client.post('/api/salary/pay-all', { bankId: 'bank' })
    expect(second.status).toBe(400)
    expect(second.json.error).toMatch(/No unpaid salary balance/)

    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM journal_entries WHERE salary_kind = 'payment'")
    expect(rows[0].n).toBe(1)
  })

  it('lets two concurrent pay-all calls run without deadlocking or double-paying — the fixed lock order guarantees a clean serialization, not just luck', async () => {
    const e1 = await insertEmployee(pool, 'Bulk Employee One', 1000)
    const e2 = await insertEmployee(pool, 'Bulk Employee Two', 2000)
    const period = '2026-08'
    await client.post('/api/salary/accrue', { employeeId: e1, period })
    await client.post('/api/salary/accrue', { employeeId: e2, period })

    const clientA = client.withSameSession()
    const clientB = client.withSameSession()
    // payAllSalaries takes a FOR UPDATE lock on every employee row up front, in a fixed
    // `ORDER BY id` — both concurrent calls request the exact same full set in the same order,
    // so the second fully blocks behind the first rather than deadlocking (a real Postgres
    // 40P01 would surface as a thrown error here, not a clean appError). If this ever regressed
    // to per-row locking without a fixed order, this is exactly the test that would catch it.
    const [resA, resB] = await Promise.all([clientA.post('/api/salary/pay-all', { bankId: 'bank' }), clientB.post('/api/salary/pay-all', { bankId: 'bank' })])

    // Because the lock is on the whole set, this split IS deterministic (unlike accrue-all
    // above): whichever call runs second always finds everything already paid.
    expect([resA.status, resB.status].sort()).toEqual([200, 400])

    const { rows } = await pool.query<{ salary_employee_id: string; n: number; total: string }>(
      "SELECT salary_employee_id, count(*)::int AS n, sum(amount)::numeric AS total FROM journal_entries WHERE salary_kind = 'payment' GROUP BY salary_employee_id",
    )
    const byEmployee = Object.fromEntries(rows.map((r) => [r.salary_employee_id, { n: r.n, total: Number(r.total) }]))
    expect(byEmployee[e1]).toEqual({ n: 1, total: 1000 })
    expect(byEmployee[e2]).toEqual({ n: 1, total: 2000 })
  })
})
