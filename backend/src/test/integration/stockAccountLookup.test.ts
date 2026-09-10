import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PoolClient } from 'pg'
import { CURRENCIES } from '@currencydesk/engine'
import { pool } from '../../db/pool.js'
import { stockAccountIdFor } from '../../services/accountHelpers.js'
import { truncateAndReseedTestDb } from '../dbFixtures.js'

// stockAccountIdFor resolves a currency code to the account that holds it. Requirement 7's
// vouchers debit and credit that account on every trade, so getting it wrong is a foreign-key
// violation on the hot path.
//
// The trap these tests exist for: 'currency' + code reads as obviously correct and produces
// 'currencyAED', which does not exist. AED lives on the account id 'currency', seeded by migration
// 008 when it was the only traded code. Every other currency got a suffixed id later. So the one
// currency the desk trades most is the one a concatenated id breaks — and it breaks at write time.
//
// No HTTP server here: this is a service-level function and the assertions are about SQL
// resolution, so a client off the pool is the whole fixture.
describe('stockAccountIdFor', () => {
  let client: PoolClient

  beforeAll(async () => {
    await truncateAndReseedTestDb(pool)
    client = await pool.connect()
  })

  afterAll(async () => {
    client.release()
    await pool.end()
  })

  it("resolves AED to 'currency', not 'currencyAED'", async () => {
    // The headline case. If this ever returns 'currencyAED' the account does not exist and every
    // AED voucher fails its foreign key.
    expect(await stockAccountIdFor(client, 'AED')).toBe('currency')
  })

  it("has no account called 'currencyAED' to fall back on", async () => {
    // Stated as its own assertion so the reason the line above matters is recorded, not implied.
    const { rows } = await client.query("SELECT 1 FROM accounts WHERE id = 'currencyAED'")
    expect(rows).toHaveLength(0)
  })

  it('resolves every traded currency to an account that actually exists', async () => {
    // Guards the whole list rather than a sample, so adding a seventh currency without seeding its
    // account fails here instead of on a dealer's first trade in it.
    for (const code of CURRENCIES) {
      const id = await stockAccountIdFor(client, code)
      expect(id, `${code} should resolve to a Currency Stock account`).toBeTruthy()

      const { rows } = await client.query("SELECT type, code FROM accounts WHERE id = $1", [id])
      expect(rows, `${code} resolved to ${id}, which should be a real account`).toHaveLength(1)
      expect(rows[0].type).toBe('Currency Stock')
      expect(String(rows[0].code).toUpperCase()).toBe(code.toUpperCase())
    }
  })

  it('does not derive the id by concatenation for any currency', async () => {
    // AED is the only one where concatenation is wrong today, but asserting the rule for all six
    // means a future rename cannot quietly make a second one wrong.
    for (const code of CURRENCIES) {
      const id = await stockAccountIdFor(client, code)
      const { rows } = await client.query('SELECT 1 FROM accounts WHERE id = $1', ['currency' + code])
      if (rows.length === 0) {
        expect(id, `'currency${code}' does not exist, so the lookup must not have produced it`).not.toBe('currency' + code)
      }
    }
  })

  it('is case-insensitive, matching how a code is checked for being taken', async () => {
    expect(await stockAccountIdFor(client, 'aed')).toBe('currency')
    expect(await stockAccountIdFor(client, 'uSd')).toBe('currencyUSD')
  })

  it('returns null for a code the desk has no account for', async () => {
    // Not an error: the caller decides. See the note on the function.
    expect(await stockAccountIdFor(client, 'GBP')).toBeNull()
    expect(await stockAccountIdFor(client, '')).toBeNull()
  })

  it('picks the original deterministically if a code is ever duplicated', async () => {
    // Two accounts on one code is a broken state the app guards but the database does not. The
    // lookup must not become arbitrary when it happens — a voucher posting to whichever row came
    // back first would scatter one currency's cost across two accounts.
    await client.query(
      `INSERT INTO accounts (id, type, name, is_system, code, notes, created_at)
       VALUES ('currencyAedDuplicate', 'Currency Stock', 'Currency stock (AED) duplicate', false, 'AED', '', now() + interval '1 day')`,
    )
    try {
      expect(await stockAccountIdFor(client, 'AED'), 'the older account wins').toBe('currency')
    } finally {
      await client.query("DELETE FROM accounts WHERE id = 'currencyAedDuplicate'")
    }
  })
})
