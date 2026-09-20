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
    // A CHEQUE CAN BE FOR MORE THAN THE CUSTOMER OWES, and the excess is not handed back over the
    // counter — it stays with the desk as a credit the customer can draw on later. Confirmed with
    // the client 2026-09-19 (AUDIT.md §3 #3, option A).
    //
    // Until then this was a plain `receivable = receivable - $1` with no guard of any kind, and
    // `accounts.receivable` carries no CHECK — so an inward cheque larger than the debt simply
    // stored a NEGATIVE receivable. The net was arithmetically right and the split was wrong,
    // which is the half that gets read: "Receivable −70,000" where the books mean "Payable 70,000".
    // It also understated the TopBar total and would let deleteAccount's balance check pass for a
    // customer who was still owed money. Cheque clearing was the only balance-moving path in the
    // codebase with neither a guard nor an allocation rule.
    //
    // SAME RULE AS postJournal AND THE JV TRANSFER: settle what is outstanding in the opposite
    // direction first, then let the remainder cross over. An inward cheque credits the customer, an
    // outward one debits them — so this is `applyCreditToCustomer`/`applyDebitToCustomer` by
    // another name, and the engine replays it with the identical allocateCredit/allocateDebit.
    //
    // ONE STATEMENT, NO READ-MODIFY-WRITE, so no `SELECT … FOR UPDATE` is needed: SQL evaluates
    // every SET against the pre-update row, and Postgres serialises concurrent writers on the same
    // row. That is the reasoning journalService.ts already sets out for the identical shape, where
    // it notes this is STRONGER than the lock-then-update the settlement paths use. The audit asked
    // for a row lock, but it did so while option B (guard + 409, which really is a lock-then-update)
    // was still on the table; choosing option A makes the lock redundant rather than optional.
    if (q.direction === 'Inward') {
      await client.query(
        `UPDATE accounts SET
           payable    = payable + GREATEST($1 - receivable, 0),
           receivable = GREATEST(receivable - $1, 0),
           updated_at = now()
         WHERE id = $2`,
        [q.amount, q.customer_id],
      )
    } else {
      await client.query(
        `UPDATE accounts SET
           receivable = receivable + GREATEST($1 - payable, 0),
           payable    = GREATEST(payable - $1, 0),
           updated_at = now()
         WHERE id = $2`,
        [q.amount, q.customer_id],
      )
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

/**
 * Cancel a cheque that should never have been entered.
 *
 * PENDING ONLY. Once a cheque is Deposited it is with the bank and its outcome is Cleared or
 * Returned; once Cleared it has moved money, and undoing that is a reversal — the corrections
 * feature that is scoped and deferred. The guard is the same `WHERE status = '…'` the other
 * transitions use, so a losing racer gets a clean 409 rather than a second history line.
 *
 * MOVES NO MONEY, and there is nothing to move: a held cheque never touched the balance in the
 * first place (settlementsService guards its balance update with `!chequeHeld`), and the replays
 * only count a cheque once its status is 'Cleared'. So the customer's debt simply stays where it
 * was, which is the correct answer for a cheque that never existed.
 *
 * The alternative before this existed was walking a mis-entry Deposited -> Returned, which wrote a
 * history saying it went to the bank and bounced — two events that did not happen, on a record the
 * client shows customers. `updated_by` and the history line record who cancelled it and when.
 */
export async function cancelCheque(client: PoolClient, id: string, actorId: string | null): Promise<void> {
  const historyLine = 'Cancelled ' + deskShortDate()
  const { rowCount } = await client.query(
    `UPDATE cheques SET status = 'Cancelled', updated_at = now(), updated_by = $2, history = array_append(history, $3)
     WHERE id = $1 AND status = 'Pending'`,
    [id, actorId, historyLine],
  )
  if (rowCount === 0) throw appError(409, 'Only a cheque that is still Pending can be cancelled.')
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
