import type { PoolClient } from 'pg'
import { stockAccountIdFor } from './accountHelpers.js'
import { buildVoucherLegs, postVoucher } from './journalService.js'
import { postOpeningStockEntries, type OpeningStockResult } from './openingStockService.js'
import { purchaseSides, saleSides, settlementSides, chequeClearingSides, type VoucherShape } from './voucherPostings.js'

// ---------------------------------------------------------------------------
// Backfill — requirement 7, phase 4
// ---------------------------------------------------------------------------
//
// Writes the vouchers phase 3 would have written, for everything recorded before phase 3 existed.
// Three passes: opening currency stock, then every activity row without a voucher, then every
// cleared cheque without one.
//
// IT BUILDS NOTHING ITSELF. Every leg shape comes from voucherPostings.ts, the same module the live
// posting path reads. That is the whole reason that module exists: a backfill that described the
// shapes a second time would produce historical vouchers differing from live ones in some case
// nobody thought to check, and the difference would not be an error — just wrong books.
//
// IT READS STORED FIGURES, NEVER RECOMPUTED ONES. pkr_value, cost, margin, paid_now and outstanding
// are taken exactly as written at deal time. `outstanding` in particular is already cheque-adjusted,
// so the cheque rule is not re-derived here either.
//
// WHAT IT MUST NOT TOUCH, and does not: accounts.receivable/payable, stock_positions, any activity
// or cheque row, and any journal entry that already exists. Balances are already correct — this is
// bookkeeping only. It writes new journal_entries rows and nothing else.
//
// SAFELY RE-RUNNABLE. Each pass skips records that already have their voucher — activity via
// activity_id, cheques via cheque_id (migration 018), opening stock via opening_for.
//
// The transaction is the CALLER's. This function neither begins nor commits, so the script can run
// it and roll back for a dry run, and the tests can run it inside their own transaction.

const MARGIN_ACCOUNT = 'margin'

export interface BackfillSkip {
  id: string
  why: string
}

export interface BackfillPass {
  considered: number
  posted: number
  legs: number
  skipped: BackfillSkip[]
}

export interface BackfillReport {
  opening: OpeningStockResult[]
  activity: BackfillPass
  cheques: BackfillPass
}

interface ActivityRowForBackfill {
  id: string
  type: 'purchase' | 'sale' | 'receive' | 'pay'
  currency: string | null
  customer_id: string | null
  customer_name: string
  amount: number
  pkr_value: number
  cost: number | null
  margin: number | null
  method: string
  paid_now: number | null
  outstanding: number | null
  txn_date: string
  settlement_account_id: string | null
}

const emptyPass = (): BackfillPass => ({ considered: 0, posted: 0, legs: 0, skipped: [] })

/** Dispatch only — every shape comes from voucherPostings. */
async function shapeFor(client: PoolClient, row: ActivityRowForBackfill): Promise<VoucherShape | null> {
  if (!row.customer_id) return null
  const currency = row.currency || 'AED'
  const ledgerOutstanding = row.outstanding ?? 0
  const paidNow = row.paid_now ?? 0

  if (row.type === 'purchase') {
    return purchaseSides({
      stockAccount: await stockAccountIdFor(client, currency),
      settlementAccount: row.settlement_account_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      method: row.method,
      currency,
      amount: row.amount,
      pkrValue: row.pkr_value,
      paidNow,
      ledgerOutstanding,
    })
  }
  if (row.type === 'sale') {
    return saleSides({
      stockAccount: await stockAccountIdFor(client, currency),
      settlementAccount: row.settlement_account_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      marginAccount: MARGIN_ACCOUNT,
      method: row.method,
      currency,
      amount: row.amount,
      cost: row.cost ?? 0,
      margin: row.margin ?? 0,
      paidNow,
      ledgerOutstanding,
    })
  }
  return settlementSides({
    direction: row.type === 'receive' ? 'receive' : 'pay',
    settlementAccount: row.settlement_account_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    method: row.method,
    amount: row.amount,
  })
}

export async function backfillVouchers(client: PoolClient, actorId: string | null): Promise<BackfillReport> {
  const opening = await postOpeningStockEntries(client, actorId)
  const activity = emptyPass()
  const cheques = emptyPass()

  const { rows: activityRows } = await client.query<ActivityRowForBackfill>(
    `SELECT id, type, currency, customer_id, customer_name, amount, pkr_value, cost, margin,
            method, paid_now, outstanding, txn_date, settlement_account_id
       FROM activity a
      WHERE NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.activity_id = a.id)
      ORDER BY created_at ASC, id ASC`,
  )
  activity.considered = activityRows.length

  for (const row of activityRows) {
    const shape = await shapeFor(client, row)
    if (!shape) {
      activity.skipped.push({ id: row.id, why: 'no customer on the row' })
      continue
    }
    const legs = buildVoucherLegs(shape.debits, shape.credits)
    if (!legs) {
      activity.skipped.push({ id: row.id, why: `no account for ${row.currency || 'AED'} stock` })
      continue
    }
    if (legs.length === 0) {
      activity.skipped.push({ id: row.id, why: 'nothing to post (cheque-settled, or zero)' })
      continue
    }
    await postVoucher(client, { activityId: row.id, txnDate: row.txn_date, narration: shape.narration, legs }, actorId)
    activity.posted++
    activity.legs += legs.length
  }

  const { rows: chequeRows } = await client.query<{
    id: string
    direction: string
    amount: number
    bank_account_id: string
    customer_id: string | null
    cleared_on: string
  }>(
    `SELECT id, direction, amount, bank_account_id, customer_id, updated_at::date AS cleared_on
       FROM cheques c
      WHERE status = 'Cleared'
        AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.cheque_id = c.id)
      ORDER BY updated_at ASC, id ASC`,
  )
  cheques.considered = chequeRows.length

  for (const q of chequeRows) {
    if (!q.customer_id) {
      cheques.skipped.push({ id: q.id, why: 'no customer on the cheque' })
      continue
    }
    const shape = chequeClearingSides({
      direction: q.direction,
      bankAccountId: q.bank_account_id,
      customerId: q.customer_id,
      amount: q.amount,
    })
    const legs = buildVoucherLegs(shape.debits, shape.credits)
    if (!legs || legs.length === 0) {
      cheques.skipped.push({ id: q.id, why: 'nothing to post' })
      continue
    }
    await postVoucher(client, { activityId: null, chequeId: q.id, txnDate: q.cleared_on, narration: shape.narration, legs }, actorId)
    cheques.posted++
    cheques.legs += legs.length
  }

  return { opening, activity, cheques }
}
