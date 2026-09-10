import type { PoolClient } from 'pg'
import { CURRENCIES, buyCalc, sellCalc, pkrPerUnit } from '@currencydesk/engine'
import { deskToday } from '../config/deskTime.js'
import { appError } from './transact.js'
import { getAccount, settlementIdFor, settlementName, stockAccountIdFor } from './accountHelpers.js'
import { insertCheque } from './chequeHelpers.js'
import { buildVoucherLegs, postVoucher } from './journalService.js'
import { purchaseSides, saleSides } from './voucherPostings.js'

/** The seeded Income account that carries trading margin. A literal id, matching how salaryService
 *  names 'salaryExpense'/'salaryPayable' — these are CORE_ACCOUNT_IDS entries the schema guarantees. */
const MARGIN_ACCOUNT = 'margin'

export interface TradeInput {
  customerId: string
  currency: string
  amount: number
  /**
   * As the dealer typed it, in `currency`'s own quote convention — PKR per 1 unit for a
   * 'multiply' currency (AED, AFN), foreign units per 1 PKR for a 'divide' one (IRR). NOT a PKR
   * figure. It is also STORED in that form (activity.rate), because engine's `unitPkr()`
   * re-derives PKR-per-unit from the stored rate plus the currency on every replay — storing an
   * already-converted value here would double-convert every report that reads it back.
   */
  rate: number
  method: 'Cash' | 'Bank' | 'Cheque' | 'Credit'
  paidNow: number
  bankId: string
  chqNo: string
  chqBank: string
  /** 'YYYY-MM-DD', already validated by routes/txnDate.ts; null means "the desk's today". */
  txnDate: string | null
}

function assertKnownCurrency(code: string): void {
  if (!CURRENCIES.includes(code)) {
    throw appError(400, `Unknown currency "${code}" — this desk trades ${CURRENCIES.join(', ')}.`)
  }
}

async function lockStock(client: PoolClient, code: string): Promise<{ available: number; avg_cost: number }> {
  // Locks the row before it's read — the weighted-average recompute below is a read-modify-write
  // that would otherwise let two concurrent trades both read the same stale (available,
  // avgCost) and have the second commit silently overwrite the first's effect on cost basis.
  //
  // A `SELECT ... FOR UPDATE` that matches no row locks NOTHING, so a missing row would silently
  // disable that guard rather than merely being a no-op. That used to be dismissible because AED
  // was the only traded code and migration 008 always pre-seeded it. It is no longer: migration
  // 012 seeds AFN/IRR too, but `createAccount` will happily create a Currency Stock account for
  // any code with no stock_positions row behind it, and a future CURRENCY_LIST entry would ship
  // before its own seed migration ran. Callers already reject any code outside CURRENCIES, and
  // this insert closes the remainder — there is always a real row to lock by the time the
  // recompute reads it.
  const locked = await client.query<{ available: number; avg_cost: number }>('SELECT available, avg_cost FROM stock_positions WHERE code = $1 FOR UPDATE', [code])
  if (locked.rows.length > 0) return locked.rows[0]

  await client.query('INSERT INTO stock_positions (code, available, avg_cost) VALUES ($1, 0, 0) ON CONFLICT (code) DO NOTHING', [code])
  const { rows } = await client.query<{ available: number; avg_cost: number }>('SELECT available, avg_cost FROM stock_positions WHERE code = $1 FOR UPDATE', [code])
  return rows[0] || { available: 0, avg_cost: 0 }
}

export async function purchase(client: PoolClient, input: TradeInput, actorId: string | null): Promise<void> {
  const cust = await getAccount(client, input.customerId)
  if (!cust) throw appError(400, 'Select a supplying customer.')
  assertKnownCurrency(input.currency)
  if (input.amount <= 0 || input.rate <= 0) throw appError(400, 'Enter a valid amount and rate greater than 0.')
  if (input.method === 'Credit' && input.paidNow > 0) {
    throw appError(400, 'A credit purchase cannot carry an amount paid now — there is no settlement account to debit.')
  }

  const code = input.currency
  const { amount, rate, pkrValue, paidNow, outstanding } = buyCalc(input.amount, input.rate, input.method, input.paidNow, code)

  const cur = await lockStock(client, code)
  const newAvail = cur.available + amount
  // stock_positions.avg_cost is canonical PKR-per-unit, so the incoming leg has to be converted
  // into that unit before it is weighted in. `rate` is a quote rate: for IRR it is ~4952 IRR per
  // PKR, and multiplying by it would book the position at roughly 24 million times its true cost.
  const unitCost = pkrPerUnit(code, rate)
  const newAvg = newAvail > 0 ? (cur.available * cur.avg_cost + amount * unitCost) / newAvail : cur.avg_cost

  const chequeHeld = input.method === 'Cheque' && paidNow > 0
  const ledgerOutstanding = chequeHeld ? pkrValue : outstanding
  const settlementAccountId = await settlementIdFor(client, input.method, input.bankId)

  // `settlementAccountId` (not the raw `input.bankId`) is what the cheque is drawn on: a blank
  // bankId resolves to the default bank account, whereas passing '' straight through violates
  // cheques.bank_account_id's foreign key with a raw 500. settlementsService.ts already fixed
  // this exact bug; these two call sites were missed at the time. chequeHeld implies
  // method === 'Cheque', for which settlementIdFor never returns null — hence the assertion.
  let chequeId: string | null = null
  if (chequeHeld) {
    const bankAccountName = await settlementName(client, settlementAccountId!)
    const inserted = await insertCheque(client, {
      direction: 'Outward',
      party: cust.name,
      customerId: input.customerId,
      amount: paidNow,
      chqNo: input.chqNo,
      chqBank: input.chqBank,
      bankAccountId: settlementAccountId!,
      bankAccountName,
      source: 'purchase',
      actorId,
    })
    chequeId = inserted.id
  }

  await client.query(
    `INSERT INTO stock_positions (code, available, avg_cost, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (code) DO UPDATE SET available = $2, avg_cost = $3, updated_at = now()`,
    [code, newAvail, newAvg],
  )
  // The date is decided HERE, on the desk's calendar, never left to the column's CURRENT_DATE
  // default — that default is the database's day, which is UTC on Neon and yesterday for the
  // first five hours of every desk day. RETURNING it still, so the voucher copies what was stored.
  const txnDate = input.txnDate ?? deskToday()
  const { rows: posted } = await client.query<{ id: string; txn_date: string }>(
    `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, method, paid_now, outstanding, cheque_held, cheque_id, settlement_account_id, txn_date, created_by, updated_by)
     VALUES ('purchase', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::date, $14, $14)
     RETURNING id, txn_date`,
    [code, input.customerId, cust.name, amount, rate, pkrValue, input.method, paidNow, ledgerOutstanding, chequeHeld, chequeId, settlementAccountId, txnDate, actorId],
  )
  await client.query('UPDATE accounts SET payable = payable + $1, updated_at = now() WHERE id = $2', [ledgerOutstanding, input.customerId])

  // Paired postings (requirement 7). The leg shape lives in voucherPostings.ts so the backfill
  // produces exactly this and cannot drift from it.
  //
  // Nothing reads these rows yet, so this must not be able to fail a trade that would otherwise
  // succeed — see buildVoucherLegs returning null when a currency has no stock account.
  const stockAccount = await stockAccountIdFor(client, code)
  const shape = purchaseSides({
    stockAccount,
    settlementAccount: settlementAccountId,
    customerId: input.customerId,
    customerName: cust.name,
    method: input.method,
    currency: code,
    amount,
    pkrValue,
    paidNow,
    ledgerOutstanding,
  })
  const legs = buildVoucherLegs(shape.debits, shape.credits)
  if (legs) {
    await postVoucher(client, { activityId: posted[0].id, txnDate: posted[0].txn_date, narration: shape.narration, legs }, actorId)
  }
}

export async function sale(client: PoolClient, input: TradeInput, actorId: string | null): Promise<void> {
  const cust = await getAccount(client, input.customerId)
  if (!cust) throw appError(400, 'Select a customer.')
  assertKnownCurrency(input.currency)
  if (input.amount <= 0 || input.rate <= 0) throw appError(400, 'Enter a valid amount and rate greater than 0.')
  if (input.method === 'Credit' && input.paidNow > 0) {
    throw appError(400, 'A credit sale cannot carry an amount received now — there is no settlement account to debit.')
  }

  const cur = await lockStock(client, input.currency)
  // Re-validated AFTER the lock, against the row's current value, not a pre-transaction read —
  // this is what actually prevents two concurrent sales from both passing this check against
  // the same stale `available` and jointly overselling the position.
  if (input.amount > cur.available) {
    throw appError(400, `Cannot sell more than available ${input.currency} stock (${cur.available.toLocaleString('en-US')} ${input.currency}).`)
  }

  // `cur.avg_cost` is passed through UNCONVERTED on purpose: it is already canonical
  // PKR-per-unit (that is the only thing stock_positions ever stores), never a quote rate. Only
  // `input.rate` — the number the dealer typed — needs `code` to be read correctly, which is
  // exactly what sellCalc's trailing argument does for `saleValue`.
  const { amount, rate, saleValue, cost, margin, paidNow, outstanding } = sellCalc(input.amount, input.rate, cur.avg_cost, input.method, input.paidNow, input.currency)
  const chequeHeld = input.method === 'Cheque' && paidNow > 0
  const ledgerOutstanding = chequeHeld ? saleValue : outstanding
  const settlementAccountId = await settlementIdFor(client, input.method, input.bankId)

  let chequeId: string | null = null
  if (chequeHeld) {
    const bankAccountName = await settlementName(client, settlementAccountId!)
    const inserted = await insertCheque(client, {
      direction: 'Inward',
      party: cust.name,
      customerId: input.customerId,
      amount: paidNow,
      chqNo: input.chqNo,
      chqBank: input.chqBank,
      bankAccountId: settlementAccountId!,
      bankAccountName,
      source: 'sale',
      actorId,
    })
    chequeId = inserted.id
  }

  await client.query('UPDATE stock_positions SET available = available - $1, updated_at = now() WHERE code = $2', [amount, input.currency])
  // Dated on the desk's calendar for the same reason as purchase() above.
  const txnDate = input.txnDate ?? deskToday()
  const { rows: posted } = await client.query<{ id: string; txn_date: string }>(
    `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, cost, margin, method, paid_now, outstanding, cheque_held, cheque_id, settlement_account_id, txn_date, created_by, updated_by)
     VALUES ('sale', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::date, $16, $16)
     RETURNING id, txn_date`,
    [input.currency, input.customerId, cust.name, amount, rate, saleValue, cost, margin, input.method, paidNow, ledgerOutstanding, chequeHeld, chequeId, settlementAccountId, txnDate, actorId],
  )
  await client.query('UPDATE accounts SET receivable = receivable + $1, updated_at = now() WHERE id = $2', [ledgerOutstanding, input.customerId])

  // Paired postings (requirement 7). The leg shape — including why a loss debits margin rather
  // than crediting a negative — lives in voucherPostings.ts, so the backfill produces exactly this.
  const stockAccount = await stockAccountIdFor(client, input.currency)
  const shape = saleSides({
    stockAccount,
    settlementAccount: settlementAccountId,
    customerId: input.customerId,
    customerName: cust.name,
    marginAccount: MARGIN_ACCOUNT,
    method: input.method,
    currency: input.currency,
    amount,
    cost,
    margin,
    paidNow,
    ledgerOutstanding,
  })
  const legs = buildVoucherLegs(shape.debits, shape.credits)
  if (legs) {
    await postVoucher(client, { activityId: posted[0].id, txnDate: posted[0].txn_date, narration: shape.narration, legs }, actorId)
  }
}
