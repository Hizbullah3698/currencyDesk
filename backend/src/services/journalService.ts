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
  /**
   * The activity row this voucher records, or null when there is no such row.
   *
   * Clearing a cheque is the case that needs null: it moves a customer balance and a bank balance,
   * so it is a real posting, but it is a transition on the cheque rather than a new deal and writes
   * no activity row. Linking it to the originating trade instead would be wrong twice over — it is
   * a different economic event, on a different date. Migration 016 left the column nullable for
   * this and for the correction vouchers that come later.
   */
  activityId: string | null
  /**
   * The cheque whose clearing produced this voucher, when one did. A leg carries this OR
   * `activityId`, never both — see migration 018. Written from the same release that adds the
   * column, not only by the backfill: a cheque cleared in between would otherwise hold a voucher
   * the backfill could not see, and be given a second one.
   */
  chequeId?: string | null
  /**
   * Marks this as the opening balance for an account, reusing the column createAccount already
   * sets for customer, bank and cash opening balances. Doubles as the backfill's idempotency key:
   * "does this account already have its opening entry?" is an EXISTS on this column.
   */
  openingFor?: string | null
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
          voucher_id, activity_id, cheque_id, opening_for, txn_date, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $12)`,
      [
        leg.narration ?? input.narration,
        leg.debitAccount,
        leg.creditAccount,
        nameOf.get(leg.debitAccount) ?? leg.debitAccount,
        nameOf.get(leg.creditAccount) ?? leg.creditAccount,
        leg.amount,
        voucherId,
        input.activityId,
        input.chequeId ?? null,
        input.openingFor ?? null,
        input.txnDate,
        actorId,
      ],
    )
  }

  return voucherId
}

/** One side of a deal: an account and what it takes. A null account means the desk has no account
 *  to post this side to — see buildVoucherLegs. */
export interface VoucherSide {
  account: string | null
  amount: number
}

/**
 * Half a paisa. Below this a figure is not a posting, it is floating-point residue from splitting
 * one total across several legs.
 */
const LEG_TOLERANCE = 0.005

/**
 * Turns the debit and credit sides of a deal into balanced two-leg rows, or null if the deal
 * cannot be represented.
 *
 * WHY THIS IS SHARED RATHER THAN WRITTEN PER CALLER. A purchase has one debit (currency stock)
 * against up to two credits (cash, the customer); a sale is the mirror, up to three debits against
 * up to two credits. Both are the same problem — allocate one side across the other — and writing
 * it twice is how the two quietly stop agreeing.
 *
 * ALLOCATION IS GREEDY, IN THE ORDER GIVEN, and that ordering is a real choice. On a part-paid sale
 * there is no fact of the matter about which rupees of the cash covered cost and which covered
 * profit, so something has to decide. Consuming the debits in order against the credits in order
 * settles the cost of goods before recognising profit, which is the conventional reading, and it
 * keeps every posted figure a whole number carried straight from buyCalc/sellCalc. A proportional
 * split would instead invent amounts that correspond to nothing and reintroduce rounding.
 *
 * RETURNS NULL when a side with money on it has no account. In practice that is a traded currency
 * with no Currency Stock account behind it — the gap stockAccountIdFor documents. The caller's
 * policy is that the trade still succeeds and simply posts no voucher, because refusing a trade
 * over bookkeeping nothing reads yet would be a regression. Posting a half-voucher instead is not
 * an option: it would be the one thing this table cannot represent, an unbalanced entry.
 */
export function buildVoucherLegs(debits: VoucherSide[], credits: VoucherSide[]): VoucherLeg[] | null {
  const dr = debits.filter((s) => s.amount > LEG_TOLERANCE)
  const cr = credits.filter((s) => s.amount > LEG_TOLERANCE)
  if (dr.length === 0 || cr.length === 0) return []
  if (dr.some((s) => !s.account) || cr.some((s) => !s.account)) return null

  const drTotal = dr.reduce((t, s) => t + s.amount, 0)
  const crTotal = cr.reduce((t, s) => t + s.amount, 0)
  if (Math.abs(drTotal - crTotal) > LEG_TOLERANCE) {
    // Not a data problem — the caller described a deal whose two sides do not agree, which means
    // the posting map itself is wrong. Loud, because a silent remainder here becomes a balance
    // sheet that does not balance months later.
    throw appError(500, `Voucher sides disagree: debits ${drTotal}, credits ${crTotal}.`)
  }

  const legs: VoucherLeg[] = []
  const remaining = dr.map((s) => s.amount)
  let i = 0
  for (const credit of cr) {
    let left = credit.amount
    while (left > LEG_TOLERANCE && i < dr.length) {
      if (remaining[i] <= LEG_TOLERANCE) {
        i++
        continue
      }
      const take = Math.min(left, remaining[i])
      legs.push({ debitAccount: dr[i].account!, creditAccount: credit.account!, amount: take })
      remaining[i] -= take
      left -= take
    }
  }
  return legs
}
