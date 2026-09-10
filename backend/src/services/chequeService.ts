import type { PoolClient } from 'pg'
import { deskShortDate, deskToday } from '../config/deskTime.js'
import { appError } from './transact.js'
import { buildVoucherLegs, postVoucher } from './journalService.js'
import { chequeClearingSides } from './voucherPostings.js'

export async function depositCheque(client: PoolClient, id: string, actorId: string | null): Promise<void> {
  const historyLine = 'Deposited ' + deskShortDate()
  const { rowCount } = await client.query(
    `UPDATE cheques SET status = 'Deposited', updated_at = now(), updated_by = $2, history = array_append(history, $3)
     WHERE id = $1 AND status = 'Pending'`,
    [id, actorId, historyLine],
  )
  if (rowCount === 0) throw appError(409, 'This cheque is no longer Pending.')
}

export async function clearCheque(client: PoolClient, id: string, actorId: string | null): Promise<void> {
  const historyLine = 'Cleared ' + deskShortDate()
  // The day it cleared, on the desk's calendar. Until 2026-09-10 this was `updated_at::date` from
  // the same UPDATE — the database's day, UTC on Neon, so a cheque cleared at 02:00 on the desk's
  // clock was journalled on the previous day while ledgerBalance() (browser-local) counted it on
  // the right one, and the reconcile harness reported the difference. Decided here, once, and
  // handed to the voucher; see config/deskTime.ts.
  const clearedOn = deskToday()
  // A single guarded UPDATE is both the atomicity guarantee and the source of the row's prior
  // values — Postgres re-evaluates the WHERE predicate under lock, so a losing racer (e.g. a
  // concurrent return on the same cheque) cleanly gets rowCount 0 rather than double-applying.
  const { rows } = await client.query<{
    customer_id: string | null
    direction: string
    amount: number
    bank_account_id: string
  }>(
    `UPDATE cheques SET status = 'Cleared', ledger_applied = true, updated_at = now(), updated_by = $2, history = array_append(history, $3)
     WHERE id = $1 AND status = 'Deposited'
     RETURNING customer_id, direction, amount, bank_account_id`,
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

    // Clearing is the only cheque transition that posts anything — see chequeClearingSides.
    //
    // activityId is null. This is a transition on the cheque, not a new deal, and writes no
    // activity row; linking it to the originating trade would attach it to a different event on a
    // different date. Its own date is the day it cleared, which is also the day ledgerBalance()
    // counts it on.
    const shape = chequeClearingSides({
      direction: q.direction,
      bankAccountId: q.bank_account_id,
      customerId: q.customer_id,
      amount: q.amount,
    })
    const legs = buildVoucherLegs(shape.debits, shape.credits)
    if (legs) {
      await postVoucher(client, { activityId: null, chequeId: id, txnDate: clearedOn, narration: shape.narration, legs }, actorId)
    }
  }
}

export async function returnCheque(client: PoolClient, id: string, actorId: string | null): Promise<void> {
  const historyLine = 'Returned ' + deskShortDate()
  const { rowCount } = await client.query(
    `UPDATE cheques SET status = 'Returned', updated_at = now(), updated_by = $2, history = array_append(history, $3)
     WHERE id = $1 AND status = 'Deposited'`,
    [id, actorId, historyLine],
  )
  if (rowCount === 0) throw appError(409, 'This cheque is no longer Deposited.')
}
