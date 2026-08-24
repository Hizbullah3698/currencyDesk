import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { handleMutation } from '../services/transact.js'
import { receive, pay, type SettleInput } from '../services/settlementsService.js'

export const settlementsRouter = Router()

function parseSettleInput(body: unknown): SettleInput {
  const b = (body ?? {}) as Record<string, unknown>
  return {
    customerId: String(b.customerId ?? ''),
    amount: Number(b.amount) || 0,
    method: b.method as SettleInput['method'],
    bankId: String(b.bankId ?? ''),
    chqNo: String(b.chqNo ?? ''),
    chqBank: String(b.chqBank ?? ''),
  }
}

settlementsRouter.post(
  '/receive',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseSettleInput(req.body)
    await handleMutation(res, (client) => receive(client, input, req.session.userId ?? null))
  }),
)

settlementsRouter.post(
  '/pay',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseSettleInput(req.body)
    await handleMutation(res, (client) => pay(client, input, req.session.userId ?? null))
  }),
)
