import type { PoolClient } from 'pg'
import { buyCalc, sellCalc } from '@currencydesk/engine'
import { appError } from './transact.js'
import { getAccount, settlementIdFor, settlementName } from './accountHelpers.js'
import { insertCheque } from './chequeHelpers.js'

export interface TradeInput {
  customerId: string
  currency: string
  amount: number
  rate: number
  method: 'Cash' | 'Bank' | 'Cheque' | 'Credit'
  paidNow: number
  bankId: string
  chqNo: string
  chqBank: string
}

async function lockStock(client: PoolClient, code: string): Promise<{ available: number; avg_cost: number }> {
  // Locks the row before it's read — the weighted-average recompute below is a read-modify-write
  // that would otherwise let two concurrent trades both read the same stale (available,
  // avgCost) and have the second commit silently overwrite the first's effect on cost basis.
  // A no-op if the code has no row yet (only matters for a brand-new currency; AED is always
  // pre-seeded by migration 008, so this is not a real gap for this app's actual scope).
  await client.query('SELECT code FROM stock_positions WHERE code = $1 FOR UPDATE', [code])
  const { rows } = await client.query<{ available: number; avg_cost: number }>('SELECT available, avg_cost FROM stock_positions WHERE code = $1', [code])
  return rows[0] || { available: 0, avg_cost: 0 }
}

export async function purchase(client: PoolClient, input: TradeInput, actorId: string | null): Promise<void> {
  const cust = await getAccount(client, input.customerId)
  if (!cust) throw appError(400, 'Select a supplying customer.')
  if (input.amount <= 0 || input.rate <= 0) throw appError(400, 'Enter a valid amount and rate greater than 0.')
  if (input.method === 'Credit' && input.paidNow > 0) {
    throw appError(400, 'A credit purchase cannot carry an amount paid now — there is no settlement account to debit.')
  }

  const { amount, rate, pkrValue, paidNow, outstanding } = buyCalc(input.amount, input.rate, input.method, input.paidNow)
  const code = input.currency

  const cur = await lockStock(client, code)
  const newAvail = cur.available + amount
  const newAvg = newAvail > 0 ? (cur.available * cur.avg_cost + amount * rate) / newAvail : cur.avg_cost

  const chequeHeld = input.method === 'Cheque' && paidNow > 0
  const ledgerOutstanding = chequeHeld ? pkrValue : outstanding
  const settlementAccountId = await settlementIdFor(client, input.method, input.bankId)

  let chequeId: string | null = null
  if (chequeHeld) {
    const bankAccountName = await settlementName(client, input.bankId)
    const inserted = await insertCheque(client, {
      direction: 'Outward',
      party: cust.name,
      customerId: input.customerId,
      amount: paidNow,
      chqNo: input.chqNo,
      chqBank: input.chqBank,
      bankAccountId: input.bankId,
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
  await client.query(
    `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, method, paid_now, outstanding, cheque_held, cheque_id, settlement_account_id, created_by, updated_by)
     VALUES ('purchase', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
    [code, input.customerId, cust.name, amount, rate, pkrValue, input.method, paidNow, ledgerOutstanding, chequeHeld, chequeId, settlementAccountId, actorId],
  )
  await client.query('UPDATE accounts SET payable = payable + $1, updated_at = now() WHERE id = $2', [ledgerOutstanding, input.customerId])
}

export async function sale(client: PoolClient, input: TradeInput, actorId: string | null): Promise<void> {
  const cust = await getAccount(client, input.customerId)
  if (!cust) throw appError(400, 'Select a customer.')
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

  const { amount, rate, saleValue, cost, margin, paidNow, outstanding } = sellCalc(input.amount, input.rate, cur.avg_cost, input.method, input.paidNow)
  const chequeHeld = input.method === 'Cheque' && paidNow > 0
  const ledgerOutstanding = chequeHeld ? saleValue : outstanding
  const settlementAccountId = await settlementIdFor(client, input.method, input.bankId)

  let chequeId: string | null = null
  if (chequeHeld) {
    const bankAccountName = await settlementName(client, input.bankId)
    const inserted = await insertCheque(client, {
      direction: 'Inward',
      party: cust.name,
      customerId: input.customerId,
      amount: paidNow,
      chqNo: input.chqNo,
      chqBank: input.chqBank,
      bankAccountId: input.bankId,
      bankAccountName,
      source: 'sale',
      actorId,
    })
    chequeId = inserted.id
  }

  await client.query('UPDATE stock_positions SET available = available - $1, updated_at = now() WHERE code = $2', [amount, input.currency])
  await client.query(
    `INSERT INTO activity (type, currency, customer_id, customer_name, amount, rate, pkr_value, cost, margin, method, paid_now, outstanding, cheque_held, cheque_id, settlement_account_id, created_by, updated_by)
     VALUES ('sale', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
    [input.currency, input.customerId, cust.name, amount, rate, saleValue, cost, margin, input.method, paidNow, ledgerOutstanding, chequeHeld, chequeId, settlementAccountId, actorId],
  )
  await client.query('UPDATE accounts SET receivable = receivable + $1, updated_at = now() WHERE id = $2', [ledgerOutstanding, input.customerId])
}
