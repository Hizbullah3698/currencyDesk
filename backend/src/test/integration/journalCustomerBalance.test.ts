import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { pool } from '../../db/pool.js'
import { startTestServer, type TestServer } from '../testServer.js'
import { ApiClient } from '../apiClient.js'
import { resetBusinessData, ensureTestUser, insertCustomer, insertEmployee } from '../dbFixtures.js'

// A hand-written journal entry against a customer must move that customer's balance too.
//
// Until 2026-09-03 it did not. The entry went into the books and the figure staff read off the
// screen stayed where it was, so the two drifted apart from the moment anyone posted one. Found on
// real production data: an entry of PKR 4,992 left a customer showing 14,600 owed while the books
// said 9,608.
//
// The subtlety these tests exist for is that a customer carries TWO columns — receivable and
// payable — at the same time, and a bare Dr/Cr does not say which one to move. The rule is: settle
// what is outstanding in the opposite direction first, then let the remainder cross over.
describe('journal entries against a customer move that customer balance', () => {
  let server: TestServer
  let admin: ApiClient
  let customerId: string
  let employeeId: string

  const ADMIN = 'jcb-admin@currencydesk.local'
  const PASSWORD = 'test-password-123'

  beforeAll(async () => {
    await resetBusinessData(pool)
    await ensureTestUser(pool, ADMIN, PASSWORD, 'admin')
    customerId = await insertCustomer(pool, 'Balance Customer')
    employeeId = await insertEmployee(pool, 'Balance Employee', 50_000)
    server = await startTestServer()
    admin = new ApiClient(server.baseUrl)
    expect((await admin.login(ADMIN, PASSWORD)).status).toBe(200)
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM journal_entries')
    await pool.query('UPDATE accounts SET receivable = 0, payable = 0')
  })

  const set = (recv: number, pay: number, id = customerId) =>
    pool.query('UPDATE accounts SET receivable = $2, payable = $3 WHERE id = $1', [id, recv, pay])

  const balance = async (id = customerId) => {
    const { rows } = await pool.query<{ r: number; p: number }>(
      'SELECT receivable::float8 AS r, payable::float8 AS p FROM accounts WHERE id = $1',
      [id],
    )
    return { receivable: rows[0].r, payable: rows[0].p, net: rows[0].r - rows[0].p }
  }

  const post = (debitAccount: string, creditAccount: string, amount: number) =>
    admin.post('/api/journal', { debitAccount, creditAccount, debitAmount: amount, creditAmount: amount, narration: 'test' })

  // --- the real case ------------------------------------------------------

  it('reproduces the production case exactly', async () => {
    // Ahmed khan on 2026-08-29: receivable 1,000 / payable 15,600, debited 4,992. The books said
    // the desk owed 9,608; the screen said 14,600. This is the figure the fix has to produce.
    await set(1_000, 15_600)
    expect((await post(customerId, 'bank', 4_992)).status).toBe(200)

    const b = await balance()
    expect(b.payable, 'settles what the desk owes first').toBe(10_608)
    expect(b.receivable, 'nothing crosses over — 4,992 fits inside the payable').toBe(1_000)
    expect(b.net, 'the figure independently established as correct').toBe(-9_608)
  })

  // --- the allocation rule ------------------------------------------------

  it('debiting settles the payable first, then the remainder becomes a receivable', async () => {
    await set(0, 3_000)
    expect((await post(customerId, 'bank', 5_000)).status).toBe(200)

    const b = await balance()
    expect(b.payable, 'the 3,000 owed is cleared').toBe(0)
    expect(b.receivable, 'the remaining 2,000 crosses over').toBe(2_000)
    expect(b.net).toBe(2_000)
  })

  it('crediting settles the receivable first, then the remainder becomes a payable', async () => {
    await set(3_000, 0)
    expect((await post('bank', customerId, 5_000)).status).toBe(200)

    const b = await balance()
    expect(b.receivable).toBe(0)
    expect(b.payable).toBe(2_000)
    expect(b.net).toBe(-2_000)
  })

  it('never drives either column negative, in either direction', async () => {
    // The property that removes the need for an `AND receivable >= $1` guard: the reduction is
    // capped at what is there and the remainder moves across, so neither column can go below zero.
    await set(0, 0)
    expect((await post(customerId, 'bank', 7_000)).status).toBe(200)
    let b = await balance()
    expect(b.receivable).toBe(7_000)
    expect(b.payable).toBe(0)

    await set(0, 0)
    expect((await post('bank', customerId, 7_000)).status).toBe(200)
    b = await balance()
    expect(b.receivable).toBe(0)
    expect(b.payable).toBe(7_000)
  })

  it('always shifts the net by exactly the amount, whichever columns move', async () => {
    // The invariant that must hold no matter how the two columns are split.
    for (const [recv, pay, amount] of [[0, 0, 500], [1_000, 0, 500], [0, 1_000, 500], [1_000, 1_000, 5_000], [400, 900, 1_300]]) {
      await set(recv, pay)
      const before = (await balance()).net
      expect((await post(customerId, 'bank', amount)).status).toBe(200)
      expect((await balance()).net, `Dr ${amount} on ${recv}/${pay}`).toBeCloseTo(before + amount, 2)

      await set(recv, pay)
      const before2 = (await balance()).net
      expect((await post('bank', customerId, amount)).status).toBe(200)
      expect((await balance()).net, `Cr ${amount} on ${recv}/${pay}`).toBeCloseTo(before2 - amount, 2)
    }
  })

  // --- scope --------------------------------------------------------------

  it('leaves an employee account alone', async () => {
    // Employee receivable/payable are memo-only and nothing on the balance sheet reads them. No
    // reason to start writing to columns nothing reads.
    await set(0, 0, employeeId)
    expect((await post(employeeId, 'bank', 9_000)).status).toBe(200)

    const b = await balance(employeeId)
    expect(b).toEqual({ receivable: 0, payable: 0, net: 0 })
  })

  it('leaves non-customer accounts alone', async () => {
    expect((await post('expense', 'bank', 2_500)).status).toBe(200)
    const { rows } = await pool.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM accounts WHERE type <> 'Customer' AND (receivable <> 0 OR payable <> 0)",
    )
    expect(Number(rows[0].n)).toBe(0)
  })

  it('moves both customers when an entry runs between two of them', async () => {
    const other = await insertCustomer(pool, 'Second Customer')
    await set(0, 2_000)
    await set(0, 0, other)

    expect((await post(customerId, other, 6_000)).status).toBe(200)

    const from = await balance()
    const to = await balance(other)
    expect(from.payable, 'debited: their payable settles first').toBe(0)
    expect(from.receivable).toBe(4_000)
    expect(to.payable, 'credited: nothing to settle, so it all becomes a payable').toBe(6_000)
    expect(from.net + to.net, 'the two sides cancel').toBe(-2_000)
  })

  it('still records the journal entry itself', async () => {
    // The balance move is an addition, not a replacement.
    await set(0, 3_000)
    expect((await post(customerId, 'bank', 1_000)).status).toBe(200)

    const { rows } = await pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM journal_entries')
    expect(Number(rows[0].n)).toBe(1)
  })
})
