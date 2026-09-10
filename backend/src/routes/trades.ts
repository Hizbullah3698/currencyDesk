import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { handleMutation, sendIfAppError } from '../services/transact.js'
import { purchase, sale, type TradeInput } from '../services/tradesService.js'
import { parseTxnDate } from './txnDate.js'
import { parseAmount } from './parse.js'

export const tradesRouter = Router()

// `rate` is passed through exactly as the dealer typed it, in the traded currency's own quote
// convention (see packages/engine/src/currencies.ts) — the client never pre-converts it to PKR,
// and this layer must not either. tradesService.ts does the one conversion, via pkrPerUnit().
function parseTradeInput(body: unknown): TradeInput {
  const b = (body ?? {}) as Record<string, unknown>
  return {
    customerId: String(b.customerId ?? ''),
    currency: String(b.currency ?? ''),
    amount: parseAmount(b.amount, 'Amount'),
    rate: parseAmount(b.rate, 'Rate'),
    method: b.method as TradeInput['method'],
    paidNow: parseAmount(b.paidNow, 'Amount paid now'),
    bankId: String(b.bankId ?? ''),
    chqNo: String(b.chqNo ?? ''),
    chqBank: String(b.chqBank ?? ''),
    txnDate: parseTxnDate(b.txnDate),
  }
}

tradesRouter.post(
  '/purchase',
  requireAuth,
  asyncHandler(async (req, res) => {
    let input: TradeInput
    try {
      input = parseTradeInput(req.body)
    } catch (err) {
      if (sendIfAppError(res, err)) return
      throw err
    }
    await handleMutation(res, req, (client) => purchase(client, input, req.session.userId ?? null))
  }),
)

tradesRouter.post(
  '/sale',
  requireAuth,
  asyncHandler(async (req, res) => {
    let input: TradeInput
    try {
      input = parseTradeInput(req.body)
    } catch (err) {
      if (sendIfAppError(res, err)) return
      throw err
    }
    await handleMutation(res, req, (client) => sale(client, input, req.session.userId ?? null))
  }),
)
