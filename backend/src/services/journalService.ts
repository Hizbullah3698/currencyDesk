import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { appError } from './transact.js'
import { getAccount } from './accountHelpers.js'

export interface JournalInput {
  debitAccount: string
  debitAmount: number
  creditAccount: string
  creditAmount: number
  narration: string
}

export async function postJournal(client: PoolClient, input: JournalInput, actorId: string | null): Promise<void> {
  if (!input.debitAccount || !input.creditAccount) throw appError(400, 'Select an account on both the debit and the credit line.')
  if (input.debitAccount === input.creditAccount) {
    const a = await getAccount(client, input.debitAccount)
    throw appError(400, `A journal entry can't debit and credit the same account${a ? ' (' + a.name + ')' : ''}.`)
  }
  if (input.debitAmount <= 0 || input.creditAmount <= 0) throw appError(400, 'Enter a debit and a credit amount greater than 0.')
  if (input.debitAmount !== input.creditAmount) throw appError(400, 'Entry is out of balance — total debit and total credit must match.')

  // Sequential, not Promise.all — a single client can only run one query at a time; see the
  // matching note in stateService.ts.
  const debitAcc = await getAccount(client, input.debitAccount)
  const creditAcc = await getAccount(client, input.creditAccount)
  if (!debitAcc || !creditAcc) throw appError(400, 'Select a valid account on both the debit and the credit line.')

  await client.query(
    `INSERT INTO journal_entries (narration, debit_account, credit_account, debit_label, credit_label, amount, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [input.narration.trim() || 'Journal entry', input.debitAccount, input.creditAccount, debitAcc.name, creditAcc.name, input.debitAmount, actorId],
  )
}

// ---------------------------------------------------------------------------
// Vouchers — requirement 7, phase 3
// ---------------------------------------------------------------------------
//
// A deal posts several journal rows that share a voucher_id. This exists because journal_entries
// is strictly two-legged and a sale needs four legs: cash and the customer debited, currency stock
// and trading margin credited. Migration 016's header records why the voucher grouping was chosen
// over restructuring the table into a header with lines.
//
// A useful property falls out of that shape: because every row is itself one debit against one
// credit for one amount, a voucher CANNOT be unbalanced. There is no "do the legs sum to zero"
// check below because there is no way to express an imbalance in the first place.
//
// NOTHING READS VOUCHERS YET. Phase 5 switches the reports over; until then these rows are inert
// and the reconciliation harness measures how far the journal still is from what the app reports.
//
// This deliberately does NOT retrofit the three existing writers of journal_entries (opening
// balances in accountsService, manual entries above, salary in salaryService). Each is a single
// balanced pair with no activity row behind it, so none of them needs a voucher, and rewriting
// working posting code to route through a new helper would be change without purpose.

export interface VoucherLeg {
  debitAccount: string
  creditAccount: string
  /** PKR. A leg of exactly 0 is dropped, not posted — see below. */
  amount: number
  /** Overrides the voucher narration for this row. */
  narration?: string
}

export interface VoucherInput {
  /** The activity row this voucher records. Every leg is linked back to it. */
  activityId: string
  /**
   * 'YYYY-MM-DD', COPIED from that activity row at write time rather than joined at read time.
   * The caller must read it back from its own INSERT (the column defaults to CURRENT_DATE, so the
   * stored value is not knowable before the row exists) and hand it over. Migration 017's header
   * records why this is a copy: a voucher's date is a fact about the voucher once posted, not a
   * view onto a row that could later move underneath it.
   */
  txnDate: string
  narration: string
  legs: VoucherLeg[]
}

/**
 * Writes the legs of one voucher and returns its id, or null if there was nothing to write.
 *
 * ZERO-AMOUNT LEGS ARE DROPPED, NOT POSTED. This is not defensive tidying — it is a real case.
 * `sellCalc` returns a margin of exactly 0 for currency sold at its weighted-average cost, and
 * journal_entries carries CHECK (amount > 0), so posting that leg would fail the whole trade over
 * a sale that is perfectly ordinary. A zero margin correctly posts nothing at all.
 *
 * A NEGATIVE amount is a caller bug rather than a business case — every figure reaching here comes
 * from buyCalc/sellCalc, which cannot produce one — so it raises instead of being silently dropped.
 */
export async function postVoucher(client: PoolClient, input: VoucherInput, actorId: string | null): Promise<string | null> {
  const legs = input.legs.filter((leg) => {
    if (leg.amount < 0) {
      throw appError(500, `A voucher leg cannot carry a negative amount (${leg.debitAccount} / ${leg.creditAccount}).`)
    }
    return leg.amount > 0
  })
  if (legs.length === 0) return null

  for (const leg of legs) {
    if (leg.debitAccount === leg.creditAccount) {
      throw appError(500, `A voucher leg cannot debit and credit the same account (${leg.debitAccount}).`)
    }
  }

  // Names for debit_label/credit_label, which are NOT NULL. Resolved in ONE query over the
  // distinct ids rather than per leg — a four-leg sale would otherwise make eight round trips, and
  // they cannot be fired concurrently because a single client runs one query at a time.
  const ids = [...new Set(legs.flatMap((l) => [l.debitAccount, l.creditAccount]))]
  const { rows: named } = await client.query<{ id: string; name: string }>(
    'SELECT id, name FROM accounts WHERE id = ANY($1::text[])',
    [ids],
  )
  const nameOf = new Map(named.map((r) => [r.id, r.name]))

  const voucherId = randomUUID()
  for (const leg of legs) {
    // `ref` is deliberately left to its sequence default. Each leg therefore takes its own JV
    // number, and those are NOT surfaced per leg: a trade is already identified by its activity
    // row, which the Transactions page shows, so minting a second human-readable name for the same
    // deal would be exactly the duplication this codebase keeps having to undo. voucher_id groups
    // the legs internally; manual entries keep their JV-nnn as the visible reference.
    await client.query(
      `INSERT INTO journal_entries
         (narration, debit_account, credit_account, debit_label, credit_label, amount,
          voucher_id, activity_id, txn_date, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $10)`,
      [
        leg.narration ?? input.narration,
        leg.debitAccount,
        leg.creditAccount,
        nameOf.get(leg.debitAccount) ?? leg.debitAccount,
        nameOf.get(leg.creditAccount) ?? leg.creditAccount,
        leg.amount,
        voucherId,
        input.activityId,
        input.txnDate,
        actorId,
      ],
    )
  }

  return voucherId
}
