// ---------------------------------------------------------------------------
// What legs each kind of movement produces — the single description
// ---------------------------------------------------------------------------
//
// One place that answers "a purchase debits what and credits what", for every movement the desk
// makes. Pure: no database, no lookups, no side effects. Callers resolve the account ids and the
// figures, this decides the shape.
//
// WHY IT WAS EXTRACTED. Phase 3 wrote these shapes inline in tradesService, settlementsService and
// chequeService. Phase 4 backfills vouchers for deals recorded before phase 3 existed, and it has
// to produce exactly what phase 3 would have produced. Describing the shapes a second time inside
// the backfill is how the two quietly stop agreeing — and the disagreement would not be an error,
// it would be historical vouchers that differ from live ones in some case nobody thought to check.
// This project has hit that failure repeatedly: the customer search written twice, the currency
// stock lookup that nearly was, the balance-sheet figures assembled four different ways.
//
// The live path and the backfill now read from the same description, so they cannot diverge.
//
// The functions take stored figures rather than recomputing them. `ledgerOutstanding` in
// particular is `activity.outstanding` as written at deal time — already cheque-adjusted — so
// neither caller re-derives that rule.

import type { VoucherSide } from './journalService.js'

export interface VoucherShape {
  debits: VoucherSide[]
  credits: VoucherSide[]
  narration: string
}

/**
 * The settlement leg of a deal.
 *
 * Cheque-settled deals move NO cash at deal time: the money moves when the cheque clears, which is
 * what ledgerBalance() already models by skipping Cheque-method activity and counting cleared
 * cheques instead. Posting the cash here would recognise money the desk has not received.
 */
export function cashLegAmount(method: string, paidNow: number): number {
  return method === 'Cheque' ? 0 : paidNow
}

/**
 * Currency bought is an asset gained, paid for in cash or bank now and/or owed to the customer.
 * One debit, up to two credits.
 */
export function purchaseSides(input: {
  stockAccount: string | null
  settlementAccount: string | null
  customerId: string
  customerName: string
  method: string
  currency: string
  amount: number
  /** PKR value of the currency bought — the full cost of the position gained. */
  pkrValue: number
  paidNow: number
  /** activity.outstanding as stored: already cheque-adjusted. */
  ledgerOutstanding: number
}): VoucherShape {
  return {
    debits: [{ account: input.stockAccount, amount: input.pkrValue }],
    credits: [
      { account: input.settlementAccount, amount: cashLegAmount(input.method, input.paidNow) },
      { account: input.customerId, amount: input.ledgerOutstanding },
    ],
    narration: `Purchase — ${input.amount} ${input.currency} from ${input.customerName}`,
  }
}

/**
 * Currency leaves at its weighted-average cost, the customer owes or pays the sale value, and the
 * difference is the desk's margin.
 *
 * THE MARGIN LEG SWITCHES SIDES ON A LOSS. sellCalc does not clamp margin, nothing rejects a sale
 * below weighted-average cost, and the reports already treat a negative margin as ordinary — so a
 * loss is a normal outcome, not an error. A loss is a DEBIT to Income reducing it, never a negative
 * credit, which postVoucher refuses outright. On a loss the stock still leaves at full cost and the
 * shortfall is debited to margin, so the two sides still meet.
 */
export function saleSides(input: {
  stockAccount: string | null
  settlementAccount: string | null
  customerId: string
  customerName: string
  marginAccount: string
  method: string
  currency: string
  amount: number
  /** Weighted-average cost of the currency sold, as stored on the activity row. */
  cost: number
  /** saleValue − cost. Negative on a loss. */
  margin: number
  paidNow: number
  /** activity.outstanding as stored: already cheque-adjusted. */
  ledgerOutstanding: number
}): VoucherShape {
  return {
    debits: [
      { account: input.settlementAccount, amount: cashLegAmount(input.method, input.paidNow) },
      { account: input.customerId, amount: input.ledgerOutstanding },
      { account: input.marginAccount, amount: input.margin < 0 ? -input.margin : 0 },
    ],
    credits: [
      { account: input.stockAccount, amount: input.cost },
      { account: input.marginAccount, amount: input.margin > 0 ? input.margin : 0 },
    ],
    narration: `Sale — ${input.amount} ${input.currency} to ${input.customerName}`,
  }
}

/**
 * A receipt is money in and the customer owing that much less; a payment is the mirror.
 *
 * Returns empty sides for a cheque-settled settlement, so it posts nothing. The live path also
 * guards this with its own `!chequeHeld` branch — around the BALANCE update, which must be guarded
 * there regardless — but the rule is stated here too so a caller that forgets the outer guard
 * still cannot recognise money that has not moved.
 */
export function settlementSides(input: {
  direction: 'receive' | 'pay'
  settlementAccount: string | null
  customerId: string
  customerName: string
  method: string
  amount: number
}): VoucherShape {
  const moves = input.method !== 'Cheque'
  const amount = moves ? input.amount : 0
  const cash: VoucherSide = { account: input.settlementAccount, amount }
  const customer: VoucherSide = { account: input.customerId, amount }
  const inbound = input.direction === 'receive'
  return {
    debits: [inbound ? cash : customer],
    credits: [inbound ? customer : cash],
    narration: inbound ? `Payment received — ${input.customerName}` : `Payment made — ${input.customerName}`,
  }
}

/**
 * Clearing is where a cheque finally moves money, and the only cheque transition that posts
 * anything — deposit and return change status alone. Inward: the bank gains and the customer owes
 * less. Outward: the reverse.
 */
export function chequeClearingSides(input: {
  direction: string
  bankAccountId: string
  customerId: string
  amount: number
}): VoucherShape {
  const inward = input.direction === 'Inward'
  const bank: VoucherSide = { account: input.bankAccountId, amount: input.amount }
  const customer: VoucherSide = { account: input.customerId, amount: input.amount }
  return {
    debits: [inward ? bank : customer],
    credits: [inward ? customer : bank],
    narration: `Cheque cleared — ${input.direction.toLowerCase()}`,
  }
}
