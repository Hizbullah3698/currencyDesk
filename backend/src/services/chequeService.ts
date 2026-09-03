import type { PoolClient } from 'pg'
import { appError } from './transact.js'
import { buildVoucherLegs, postVoucher } from './journalService.js'
import { shortDate } from './chequeHelpers.js'

export async function depositCheque(client: PoolClient, id: string, actorId: string | null): Promise<void> {
  const historyLine = 'Deposited ' + shortDate(new Date())
  const { rowCount } = await client.query(
    `UPDATE cheques SET status = 'Deposited', updated_at = now(), updated_by = $2, history = array_append(history, $3)
     WHERE id = $1 AND status = 'Pending'`,
    [id, actorId, historyLine],
  )
  if (rowCount === 0) throw appError(409, 'This cheque is no longer Pending.')
}

export async function clearCheque(client: PoolClient, id: string, actorId: string | null): Promise<void> {
  const historyLine = 'Cleared ' + shortDate(new Date())
  // A single guarded UPDATE is both the atomicity guarantee and the source of the row's prior
  // values — Postgres re-evaluates the WHERE predicate under lock, so a losing racer (e.g. a
  // concurrent return on the same cheque) cleanly gets rowCount 0 rather than double-applying.
  const { rows } = await client.query<{
    customer_id: string | null
    direction: string
    amount: number
    bank_account_id: string
    cleared_on: string
  }>(
    `UPDATE cheques SET status = 'Cleared', ledger_applied = true, updated_at = now(), updated_by = $2, history = array_append(history, $3)
     WHERE id = $1 AND status = 'Deposited'
     RETURNING customer_id, direction, amount, bank_account_id, updated_at::date AS cleared_on`,
    [id, actorId, historyLine],
  )
  if (rows.length === 0) throw appError(409, 'This cheque is no longer Deposited.')

  const q = rows[0]
  if (q.customer_id) {
    if (q.direction === 'Inward') {
      await client.query('UPDATE accounts SET receivable = receivable - $1, updated_at = now() WHERE id = $2', [q.amount, q.customer_id])
    } else {
      await client.query('UPDATE accounts SET payable = payable - $1, updated_at = now() WHERE id = $2', [q.amount, q.customer_id])
    }

    // Clearing is where a cheque finally moves money, which is why it is the only transition that
    // posts anything — deposit and return change status alone. Inward: the bank gains and the
    // customer owes less. Outward: the reverse.
    //
    // activityId is null. This is a transition on the cheque, not a new deal, and writes no
    // activity row; linking it to the originating trade would attach it to a different event on a
    // different date. Its own date is the day it cleared, which is also the day ledgerBalance()
    // counts it on.
    const legs = buildVoucherLegs(
      [{ account: q.direction === 'Inward' ? q.bank_account_id : q.customer_id, amount: q.amount }],
      [{ account: q.direction === 'Inward' ? q.customer_id : q.bank_account_id, amount: q.amount }],
    )
    if (legs) {
      await postVoucher(
        client,
        { activityId: null, txnDate: q.cleared_on, narration: `Cheque cleared — ${q.direction.toLowerCase()}`, legs },
        actorId,
      )
    }
  }
}

export async function returnCheque(client: PoolClient, id: string, actorId: string | null): Promise<void> {
  const historyLine = 'Returned ' + shortDate(new Date())
  const { rowCount } = await client.query(
    `UPDATE cheques SET status = 'Returned', updated_at = now(), updated_by = $2, history = array_append(history, $3)
     WHERE id = $1 AND status = 'Deposited'`,
    [id, actorId, historyLine],
  )
  if (rowCount === 0) throw appError(409, 'This cheque is no longer Deposited.')
}
