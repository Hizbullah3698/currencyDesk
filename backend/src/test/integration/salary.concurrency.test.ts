import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { resetBusinessData, ensureTestUser, insertEmployee } from '../dbFixtures.js'

describe('concurrent salary accrual for the same employee/period', () => {
  let server: TestServer
  let client: ApiClient
  let employeeId: string

  beforeAll(async () => {
    await resetBusinessData(pool)
    await ensureTestUser(pool, 'concurrency-salary@currencydesk.local', 'test-password-123', 'admin')
    employeeId = await insertEmployee(pool, 'Concurrency Test Employee', 50000)

    server = await startTestServer()
    client = new ApiClient(server.baseUrl)
    const login = await client.login('concurrency-salary@currencydesk.local', 'test-password-123')
    expect(login.status).toBe(200)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  it('lets exactly one of two concurrent accrue requests for the same period succeed, rejecting the other cleanly via the partial unique index', async () => {
    const clientA = client.withSameSession()
    const clientB = client.withSameSession()
    const body = { employeeId, period: '2026-08' }

    const [resA, resB] = await Promise.all([clientA.post('/api/salary/accrue', body), clientB.post('/api/salary/accrue', body)])

    const statuses = [resA.status, resB.status].sort()
    expect(statuses).toEqual([200, 409])

    const failed = resA.status === 409 ? resA : resB
    expect(failed.json.error).toMatch(/already accrued/)

    // Confirmed by counting the actual rows afterward, not just trusting the two HTTP responses
    // (mirrors the standard this project's manual Phase 2 verification held itself to).
    const { rows } = await pool.query(
      "SELECT count(*) FROM journal_entries WHERE salary_employee_id = $1 AND salary_period = $2 AND salary_kind = 'accrual'",
      [employeeId, '2026-08'],
    )
    expect(Number(rows[0].count)).toBe(1)
  })
})
