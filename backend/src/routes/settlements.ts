import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { handleMutation, sendIfAppError } from '../services/transact.js'
import { receive, pay, type SettleInput } from '../services/settlementsService.js'
import { parseTxnDate } from './txnDate.js'

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
    txnDate: parseTxnDate(b.txnDate),
  }
}

settlementsRouter.post(
  '/receive',
  requireAuth,
  asyncHandler(async (req, res) => {
    let input: SettleInput
    try {
      input = parseSettleInput(req.body)
    } catch (err) {
      if (sendIfAppError(res, err)) return
      throw err
    }
    await handleMutation(res, req, (client) => receive(client, input, req.session.userId ?? null))
  }),
)

settlementsRouter.post(
  '/pay',
  requireAuth,
  asyncHandler(async (req, res) => {
    let input: SettleInput
    try {
      input = parseSettleInput(req.body)
    } catch (err) {
      if (sendIfAppError(res, err)) return
      throw err
    }
    await handleMutation(res, req, (client) => pay(client, input, req.session.userId ?? null))
  }),
)
