import type { PoolClient } from 'pg'
import type { Cheque } from '@currencydesk/engine'
import { nextChequeNumber, chequeNoError } from '@currencydesk/engine'
import { appError } from './transact.js'

export function shortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export interface BuildChequeInput {
  direction: 'Inward' | 'Outward'
  party: string
  customerId: string | null
  amount: number
  chqNo: string
  chqBank: string
  bankAccountId: string
  bankAccountName: string
  source: string
  actorId: string | null
}

const UNIQUE_VIOLATION = '23505'

/**
 * Validates + inserts a cheque row. `nextChequeNumber` (from @currencydesk/engine, unchanged)
 * scans forward from a seed to skip any already-taken numbers; the seed itself comes from
 * `cheque_number_seq`, so two concurrent blank-number inserts start their scans from different,
 * atomically-issued values instead of both starting at the same fixed constant. That alone
 * doesn't fully rule out a collision (a manually-typed number could still coincide, or two
 * scans could converge), so `cheques_number_uniq` is the real backstop: on a 23505 against it,
 * this re-reads the current numbers and retries once with a fresh scan.
 */
export async function insertCheque(client: PoolClient, input: BuildChequeInput): Promise<{ id: string; number: string }> {
  const explicitNumber = input.chqNo.trim()

  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 14)
  const dueDateStr = dueDate.toISOString().slice(0, 10)
  const historyLine = 'Recorded ' + shortDate(new Date())
  const bank = input.chqBank.trim() || input.bankAccountName

  for (let attempt = 0; attempt < 2; attempt++) {
    const { rows } = await client.query<{ number: string }>('SELECT number FROM cheques')
    // nextChequeNumber only reads `.number` off each element — this cast avoids requiring
    // callers to fabricate full Cheque objects just to reuse the shared skip-taken-numbers scan.
    const existingAsCheques = rows as unknown as Cheque[]

    const err = chequeNoError(existingAsCheques, explicitNumber ? 'Cheque' : '', explicitNumber)
    if (err) throw appError(400, err)

    let number = explicitNumber
    if (!number) {
      const { rows: seedRows } = await client.query<{ n: string }>("SELECT nextval('cheque_number_seq')::text AS n")
      number = String(nextChequeNumber(existingAsCheques, Number(seedRows[0].n)))
    }

    // A failed INSERT aborts the enclosing transaction until rolled back — without this
    // savepoint, the retry's own next SELECT would fail with "current transaction is aborted"
    // before it ever got to recompute anything, silently defeating the whole retry mechanism.
    // (Verified for real: a forced concurrent collision on this exact constraint reproduced
    // that failure mode before this savepoint was added, and resolved cleanly after.)
    await client.query('SAVEPOINT insert_cheque_attempt')
    try {
      const { rows: inserted } = await client.query<{ id: string }>(
        `INSERT INTO cheques (direction, number, party, customer_id, bank, bank_account_id, amount, due_date, history, source, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ARRAY[$9::text], $10, $11, $11)
         RETURNING id`,
        [input.direction, number, input.party, input.customerId, bank, input.bankAccountId, input.amount, dueDateStr, historyLine, input.source, input.actorId],
      )
      await client.query('RELEASE SAVEPOINT insert_cheque_attempt')
      return { id: inserted[0].id, number }
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT insert_cheque_attempt')
      const pgErr = err as { code?: string; constraint?: string }
      if (attempt === 0 && pgErr.code === UNIQUE_VIOLATION && pgErr.constraint === 'cheques_number_uniq') {
        continue // re-read + retry once with a fresh scan
      }
      throw err
    }
  }
  throw appError(409, 'Could not allocate a unique cheque number — try again.')
}
