import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { handleMutation } from '../services/transact.js'
import { purchase, sale, type TradeInput } from '../services/tradesService.js'

export const tradesRouter = Router()

function parseTradeInput(body: unknown): TradeInput {
  const b = (body ?? {}) as Record<string, unknown>
  return {
    customerId: String(b.customerId ?? ''),
    currency: String(b.currency ?? ''),
    amount: Number(b.amount) || 0,
    rate: Number(b.rate) || 0,
    method: b.method as TradeInput['method'],
    paidNow: Number(b.paidNow) || 0,
    bankId: String(b.bankId ?? ''),
    chqNo: String(b.chqNo ?? ''),
    chqBank: String(b.chqBank ?? ''),
  }
}

tradesRouter.post(
  '/purchase',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseTradeInput(req.body)
    await handleMutation(res, (client) => purchase(client, input, req.session.userId ?? null))
  }),
)

tradesRouter.post(
  '/sale',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseTradeInput(req.body)
    await handleMutation(res, (client) => sale(client, input, req.session.userId ?? null))
  }),
)
