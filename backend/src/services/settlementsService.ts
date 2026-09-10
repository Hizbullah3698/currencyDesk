import type { PoolClient } from 'pg'
import { deskToday } from '../config/deskTime.js'
import { appError } from './transact.js'
import { getAccount, settlementIdFor, settlementName } from './accountHelpers.js'
import { buildVoucherLegs, postVoucher } from './journalService.js'
import { settlementSides } from './voucherPostings.js'
import { insertCheque } from './chequeHelpers.js'

// A receive/pay moves PKR against a customer's receivable/payable — there is no foreign
// currency and no rate anywhere in this file, so none of the quote-convention handling in
// tradesService.ts applies here. `amount` is PKR and is written straight to both `amount` and
// `pkr_value` (see the inserts below), which is why there is nothing to convert.
export interface SettleInput {
  customerId: string
  amount: number
  /**
   * A payment is money actually moving: 'Cash' from the drawer, 'Bank' by transfer, or 'Cheque'.
   * Deliberately NOT 'Credit' — that is a trade's way of saying "nothing settled, it is all on
   * account", and it has no cash-side account. Fed to receive/pay it used to move the customer's
   * balance while posting no voucher (settlementIdFor returns null, buildVoucherLegs then returns
   * null on the accountless side), so money was recorded as received with nothing receiving it and
   * the shortfall vanished into the balance sheet's equity plug — AUDIT.md §3 #8. Narrowed here so
   * the compiler catches a future caller passing it, and rejected at runtime in receive/pay below
   * for a request that reaches the service anyway (the route casts an `unknown` body).
   */
  method: 'Cash' | 'Bank' | 'Cheque'
  bankId: string
  chqNo: string
  chqBank: string
  /** 'YYYY-MM-DD', already validated by routes/txnDate.ts; null means "the desk's today". */
  txnDate: string | null
}

/**
 * Rejects a settlement method that is not a real money movement, before any row is touched.
 *
 * The type above already forbids 'Credit', but `routes/settlements.ts` builds a `SettleInput` by
 * casting an `unknown` request body, so a hand-built `{ method: 'Credit' }` still arrives here.
 * This is the runtime half of the same guard.
 */
function assertSettlementMethod(method: string): void {
  if (method !== 'Cash' && method !== 'Bank' && method !== 'Cheque') {
    throw appError(400, 'A payment needs a cash, bank or cheque method.')
  }
}

export async function receive(client: PoolClient, input: SettleInput, actorId: string | null): Promise<void> {
  assertSettlementMethod(input.method)
  const cust = await getAccount(client, input.customerId)
  if (!cust) throw appError(400, 'Select a customer.')

  // Locked before validating the bound, then the actual decrement below is guarded by the same
  // predicate — a bare relative-delta update would let two concurrent receipts against the same
  // stale receivable both pass this check and jointly drive the balance negative.
  await client.query('SELECT receivable FROM accounts WHERE id = $1 FOR UPDATE', [input.customerId])
  const { rows } = await client.query<{ receivable: number }>('SELECT receivable FROM accounts WHERE id = $1', [input.customerId])
  const receivable = rows[0]?.receivable || 0
  if (input.amount <= 0 || input.amount > receivable) throw appError(400, 'Enter an amount between 1 and the outstanding receivable.')

  const chequeHeld = input.method === 'Cheque'
  // Resolved once, with the same blank-bankId-falls-back-to-the-default-bank behavior trades.ts
  // gets from this same helper — reused below instead of the raw, possibly-blank input.bankId,
  // which would otherwise violate cheques.bank_account_id's foreign key (a gap the old
  // localStorage version never caught, since it had no referential integrity to violate).
  const settlementAccountId = await settlementIdFor(client, input.method, input.bankId)

  let chequeId: string | null = null
  if (chequeHeld) {
    const bankAccountName = await settlementName(client, settlementAccountId!)
    const inserted = await insertCheque(client, {
      direction: 'Inward',
      party: cust.name,
      customerId: input.customerId,
      amount: input.amount,
      chqNo: input.chqNo,
      chqBank: input.chqBank,
      bankAccountId: settlementAccountId!,
      bankAccountName,
      source: 'payment in',
      actorId,
    })
    chequeId = inserted.id
  }

  // Dated on the desk's calendar, never by the column's CURRENT_DATE default — see tradesService.
  // RETURNING the stored txn_date so the voucher copies what was written.
  const txnDate = input.txnDate ?? deskToday()
  const { rows: posted } = await client.query<{ id: string; txn_date: string }>(
    `INSERT INTO activity (type, customer_id, customer_name, amount, pkr_value, method, cheque_held, cheque_id, settlement_account_id, txn_date, created_by, updated_by)
     VALUES ('receive', $1, $2, $3, $3, $4, $5, $6, $7, $8::date, $9, $9)
     RETURNING id, txn_date`,
    [input.customerId, cust.name, input.amount, input.method, chequeHeld, chequeId, settlementAccountId, txnDate, actorId],
  )

  if (!chequeHeld) {
    const { rowCount } = await client.query('UPDATE accounts SET receivable = receivable - $1, updated_at = now() WHERE id = $2 AND receivable >= $1', [input.amount, input.customerId])
    if (rowCount === 0) throw appError(409, 'Amount exceeds the outstanding receivable — it may have just changed.')

    // Inside the same `!chequeHeld` branch as the balance move — a receipt taken by cheque shifts
    // nothing until the cheque clears. settlementSides states that rule too, so a caller that
    // forgot this guard still could not recognise money that has not moved.
    const shape = settlementSides({
      direction: 'receive',
      settlementAccount: settlementAccountId,
      customerId: input.customerId,
      customerName: cust.name,
      method: input.method,
      amount: input.amount,
    })
    const legs = buildVoucherLegs(shape.debits, shape.credits)
    if (legs) {
      await postVoucher(client, { activityId: posted[0].id, txnDate: posted[0].txn_date, narration: shape.narration, legs }, actorId)
    }
  }
}

export async function pay(client: PoolClient, input: SettleInput, actorId: string | null): Promise<void> {
  assertSettlementMethod(input.method)
  const cust = await getAccount(client, input.customerId)
  if (!cust) throw appError(400, 'Select a customer.')

  await client.query('SELECT payable FROM accounts WHERE id = $1 FOR UPDATE', [input.customerId])
  const { rows } = await client.query<{ payable: number }>('SELECT payable FROM accounts WHERE id = $1', [input.customerId])
  const payable = rows[0]?.payable || 0
  if (input.amount <= 0 || input.amount > payable) throw appError(400, 'Enter an amount between 1 and the outstanding payable.')

  const chequeHeld = input.method === 'Cheque'
  const settlementAccountId = await settlementIdFor(client, input.method, input.bankId)

  let chequeId: string | null = null
  if (chequeHeld) {
    const bankAccountName = await settlementName(client, settlementAccountId!)
    const inserted = await insertCheque(client, {
      direction: 'Outward',
      party: cust.name,
      customerId: input.customerId,
      amount: input.amount,
      chqNo: input.chqNo,
      chqBank: input.chqBank,
      bankAccountId: settlementAccountId!,
      bankAccountName,
      source: 'payment out',
      actorId,
    })
    chequeId = inserted.id
  }

  const txnDate = input.txnDate ?? deskToday()
  const { rows: posted } = await client.query<{ id: string; txn_date: string }>(
    `INSERT INTO activity (type, customer_id, customer_name, amount, pkr_value, method, cheque_held, cheque_id, settlement_account_id, txn_date, created_by, updated_by)
     VALUES ('pay', $1, $2, $3, $3, $4, $5, $6, $7, $8::date, $9, $9)
     RETURNING id, txn_date`,
    [input.customerId, cust.name, input.amount, input.method, chequeHeld, chequeId, settlementAccountId, txnDate, actorId],
  )

  if (!chequeHeld) {
    const { rowCount } = await client.query('UPDATE accounts SET payable = payable - $1, updated_at = now() WHERE id = $2 AND payable >= $1', [input.amount, input.customerId])
    if (rowCount === 0) throw appError(409, 'Amount exceeds the outstanding payable — it may have just changed.')

    // The mirror of receive: money out, and the desk owes that much less.
    const shape = settlementSides({
      direction: 'pay',
      settlementAccount: settlementAccountId,
      customerId: input.customerId,
      customerName: cust.name,
      method: input.method,
      amount: input.amount,
    })
    const legs = buildVoucherLegs(shape.debits, shape.credits)
    if (legs) {
      await postVoucher(client, { activityId: posted[0].id, txnDate: posted[0].txn_date, narration: shape.narration, legs }, actorId)
    }
  }
}
