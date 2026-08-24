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
