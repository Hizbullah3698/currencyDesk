import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { resetBusinessData, ensureTestUser, insertCustomer } from '../dbFixtures.js'

// USD, EUR and JPY, added in migration 014 to complete the client's six-currency list.
//
// All three are ordinary 'multiply' quotes, like AED — so the point of these tests is NOT to prove
// a new mechanism works, it is to confirm each new code is actually wired end to end: accepted by
// the trade route, valued by the right arithmetic, and landing in a stock position that exists.
// The failure mode being guarded against is not an exception; it is a cheerful 200 that books a
// position at the wrong figure, which is why every assertion is against the number Postgres ends
// up holding rather than against the HTTP status.
describe('USD / EUR / JPY end-to-end', () => {
  let server: TestServer
  let client: ApiClient
  let customerId: string

  const EMAIL = 'new-currencies@currencydesk.local'
  const PASSWORD = 'test-password-123'

  beforeAll(async () => {
    await resetBusinessData(pool)
    await ensureTestUser(pool, EMAIL, PASSWORD, 'admin')
    customerId = await insertCustomer(pool, 'New Currency Supplier')
    server = await startTestServer()
    client = new ApiClient(server.baseUrl)
    expect((await client.login(EMAIL, PASSWORD)).status).toBe(200)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  const buy = (currency: string, amount: number, rate: number) =>
    client.post('/api/trades/purchase', {
      customerId,
      currency,
      amount,
      rate,
      method: 'Credit',
      paidNow: 0,
      bankId: '',
      chqNo: '',
      chqBank: '',
    })

  const position = async (code: string) => {
    const { rows } = await pool.query<{ available: number; avg_cost: number }>(
      'SELECT available, avg_cost FROM stock_positions WHERE code = $1',
      [code],
    )
    return rows[0]
  }

  // Realistic rates, each the ordinary "PKR per 1 unit" direction. The expected PKR value is
  // amount × rate — if any of these were mistakenly treated as a divide-quote like IRR, the stored
  // value would be out by many orders of magnitude rather than slightly wrong.
  const CASES = [
    { code: 'USD', amount: 1_000, rate: 282.5, pkr: 282_500 },
    { code: 'EUR', amount: 1_000, rate: 328.75, pkr: 328_750 },
    { code: 'JPY', amount: 100_000, rate: 1.9, pkr: 190_000 },
  ]

  for (const c of CASES) {
    it(`values a ${c.code} purchase by multiplying: ${c.amount} × ${c.rate} = ${c.pkr} PKR`, async () => {
      const res = await buy(c.code, c.amount, c.rate)
      expect(res.status, JSON.stringify(res.json)).toBe(200)

      const { rows } = await pool.query<{ pkr_value: number; amount: number; rate: number }>(
        "SELECT pkr_value, amount, rate FROM activity WHERE currency = $1 AND type = 'purchase'",
        [c.code],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].amount).toBe(c.amount)
      expect(Number(rows[0].rate)).toBeCloseTo(c.rate, 4)
      expect(Number(rows[0].pkr_value)).toBeCloseTo(c.pkr, 2)

      // The position is carried at PKR-per-unit, which for a multiply quote is the typed rate.
      const pos = await position(c.code)
      expect(pos.available).toBe(c.amount)
      expect(Number(pos.avg_cost)).toBeCloseTo(c.rate, 6)
    })
  }

  it('re-weights a JPY position across two rates like any other currency', async () => {
    // JPY is the weakest of the new codes at ~1.9 PKR, close enough to parity that a
    // multiply/divide mix-up would still produce a plausible-looking number rather than an
    // obviously absurd one — so the averaging is checked explicitly rather than assumed.
    // Already holds 100,000 @ 1.9 from the case above. Add 100,000 @ 2.1:
    //   (100000×1.9 + 100000×2.1) / 200000 = 2.0
    expect((await buy('JPY', 100_000, 2.1)).status).toBe(200)

    const pos = await position('JPY')
    expect(pos.available).toBe(200_000)
    expect(Number(pos.avg_cost)).toBeCloseTo(2.0, 6)
  })

  it('carries each new currency on its own Currency Stock account, not a shared one', async () => {
    // One account per traded currency is what lets the Balance Sheet show each at its own cost.
    // Two codes sharing an account would double-count one position and hide the other.
    const { rows } = await pool.query<{ id: string; code: string }>(
      "SELECT id, code FROM accounts WHERE type = 'Currency Stock' ORDER BY code",
    )
    expect(rows.map((r) => r.code)).toEqual(['AED', 'AFN', 'EUR', 'IRR', 'JPY', 'USD'])
    expect(new Set(rows.map((r) => r.id)).size).toBe(6)
  })

  it('still rejects a currency the desk does not trade', async () => {
    // The guard has to keep working now the accepted set is larger — CHF is a plausible thing for
    // someone to try, and it must not silently create a position.
    const res = await buy('CHF', 100, 320)
    expect(res.status).toBe(400)
    expect(res.json.error).toMatch(/CHF/)
    expect(await position('CHF')).toBeUndefined()
  })
})
