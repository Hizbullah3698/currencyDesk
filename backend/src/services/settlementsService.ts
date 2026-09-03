import type { PoolClient } from 'pg'
import { appError } from './transact.js'
import { getAccount, settlementIdFor, settlementName } from './accountHelpers.js'
import { buildVoucherLegs, postVoucher } from './journalService.js'
import { insertCheque } from './chequeHelpers.js'

// A receive/pay moves PKR against a customer's receivable/payable — there is no foreign
// currency and no rate anywhere in this file, so none of the quote-convention handling in
// tradesService.ts applies here. `amount` is PKR and is written straight to both `amount` and
// `pkr_value` (see the inserts below), which is why there is nothing to convert.
export interface SettleInput {
  customerId: string
  amount: number
  method: 'Cash' | 'Bank' | 'Cheque' | 'Credit'
  bankId: string
  chqNo: string
  chqBank: string
  /** 'YYYY-MM-DD', already validated by routes/txnDate.ts; null means "default to today". */
  txnDate: string | null
}

export async function receive(client: PoolClient, input: SettleInput, actorId: string | null): Promise<void> {
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

  // RETURNING the stored txn_date so the voucher copies what was written rather than re-deriving
  // the COALESCE above — same reasoning as tradesService.
  const { rows: posted } = await client.query<{ id: string; txn_date: string }>(
    `INSERT INTO activity (type, customer_id, customer_name, amount, pkr_value, method, cheque_held, cheque_id, settlement_account_id, txn_date, created_by, updated_by)
     VALUES ('receive', $1, $2, $3, $3, $4, $5, $6, $7, COALESCE($8::date, CURRENT_DATE), $9, $9)
     RETURNING id, txn_date`,
    [input.customerId, cust.name, input.amount, input.method, chequeHeld, chequeId, settlementAccountId, input.txnDate, actorId],
  )

  if (!chequeHeld) {
    const { rowCount } = await client.query('UPDATE accounts SET receivable = receivable - $1, updated_at = now() WHERE id = $2 AND receivable >= $1', [input.amount, input.customerId])
    if (rowCount === 0) throw appError(409, 'Amount exceeds the outstanding receivable — it may have just changed.')

    // Money in, and the customer owes that much less. Deliberately inside the same `!chequeHeld`
    // branch as the balance move: a receipt taken by cheque shifts nothing until the cheque clears,
    // so posting anything here would recognise money the desk does not have. clearCheque posts it.
    const legs = buildVoucherLegs(
      [{ account: settlementAccountId, amount: input.amount }],
      [{ account: input.customerId, amount: input.amount }],
    )
    if (legs) {
      await postVoucher(
        client,
        { activityId: posted[0].id, txnDate: posted[0].txn_date, narration: `Payment received — ${cust.name}`, legs },
        actorId,
      )
    }
  }
}

export async function pay(client: PoolClient, input: SettleInput, actorId: string | null): Promise<void> {
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

  const { rows: posted } = await client.query<{ id: string; txn_date: string }>(
    `INSERT INTO activity (type, customer_id, customer_name, amount, pkr_value, method, cheque_held, cheque_id, settlement_account_id, txn_date, created_by, updated_by)
     VALUES ('pay', $1, $2, $3, $3, $4, $5, $6, $7, COALESCE($8::date, CURRENT_DATE), $9, $9)
     RETURNING id, txn_date`,
    [input.customerId, cust.name, input.amount, input.method, chequeHeld, chequeId, settlementAccountId, input.txnDate, actorId],
  )

  if (!chequeHeld) {
    const { rowCount } = await client.query('UPDATE accounts SET payable = payable - $1, updated_at = now() WHERE id = $2 AND payable >= $1', [input.amount, input.customerId])
    if (rowCount === 0) throw appError(409, 'Amount exceeds the outstanding payable — it may have just changed.')

    // The mirror of receive: money out, and the desk owes that much less.
    const legs = buildVoucherLegs(
      [{ account: input.customerId, amount: input.amount }],
      [{ account: settlementAccountId, amount: input.amount }],
    )
    if (legs) {
      await postVoucher(
        client,
        { activityId: posted[0].id, txnDate: posted[0].txn_date, narration: `Payment made — ${cust.name}`, legs },
        actorId,
      )
    }
  }
}
