import type { PoolClient } from 'pg'

export async function getAccount(client: PoolClient, id: string | null | undefined) {
  if (!id) return undefined
  const { rows } = await client.query('SELECT * FROM accounts WHERE id = $1', [id])
  return rows[0] as
    | {
        id: string
        type: string
        name: string
        receivable: number
        payable: number
        monthly_salary: number | null
      }
    | undefined
}

export async function settlementName(client: PoolClient, id: string): Promise<string> {
  const a = await getAccount(client, id)
  return a?.name || '—'
}

export async function defaultBankId(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ id: string }>("SELECT id FROM accounts WHERE type = 'Bank' ORDER BY created_at ASC LIMIT 1")
  return rows[0]?.id || 'bank'
}

export async function settlementIdFor(client: PoolClient, method: string, bankId: string): Promise<string | null> {
  if (method === 'Cash') return 'cash'
  if (method === 'Bank' || method === 'Cheque') return bankId || (await defaultBankId(client))
  // Credit has no settlement account at all — must be a real NULL, not '', since
  // activity.settlement_account_id has a foreign key to accounts(id) and '' is not NULL.
  return null
}

/**
 * The Currency Stock account that holds `code`, or null if the desk has none.
 *
 * **Never derive this id by string concatenation.** `'currency' + code` looks obviously right and
 * is wrong for the desk's most-traded currency: AED's account is `'currency'`, seeded by migration
 * 008 back when AED was the only code, while AFN/IRR/USD/EUR/JPY got `'currencyAFN'` and friends
 * from 012 and 014. There is no `'currencyAED'`. A concatenated id therefore violates the foreign
 * key on the one currency the desk trades most, and does it at write time rather than review time.
 * Resolving by `code` is the only correct route, which is why this lives here as one shared
 * function rather than inline at a call site waiting to be copy-pasted.
 *
 * `upper()` on both sides matches how accountsService decides a code is already taken, so the two
 * agree about which account a code refers to.
 *
 * ON DUPLICATES — deterministic, and deliberately not an error. Two accounts sharing a code is
 * already a broken state (both value the same position, so it double-counts as an asset) but it is
 * only guarded in application code, not by a database constraint. Ordering picks the original
 * consistently instead of an arbitrary row. Throwing here was considered and rejected: it would
 * stop the desk trading over a pre-existing bookkeeping fault that trading itself does not depend
 * on, which is a worse outcome than posting consistently to the older account.
 *
 * ON NULL — the caller's policy, not this function's. It happens when a code is in the engine's
 * CURRENCY_LIST but its seed migration has not run, the same gap `lockStock()` closes for
 * `stock_positions`. That cannot be papered over the same way, because an account id cannot be
 * invented.
 */
export async function stockAccountIdFor(client: PoolClient, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM accounts
     WHERE type = 'Currency Stock' AND upper(code) = upper($1)
     ORDER BY created_at ASC, id ASC
     LIMIT 1`,
    [code],
  )
  return rows[0]?.id ?? null
}

export async function accountHasActivity(client: PoolClient, id: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM activity WHERE customer_id = $1
     UNION ALL SELECT 1 FROM cheques WHERE customer_id = $1
     UNION ALL SELECT 1 FROM journal_entries WHERE debit_account = $1 OR credit_account = $1
     LIMIT 1`,
    [id],
  )
  return (rows.length ?? 0) > 0
}
