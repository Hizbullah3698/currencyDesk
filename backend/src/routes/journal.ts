import { Router } from 'express'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { handleMutation } from '../services/transact.js'
import { postJournal, type JournalInput } from '../services/journalService.js'

export const journalRouter = Router()

journalRouter.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const input: JournalInput = {
      debitAccount: String(b.debitAccount ?? ''),
      debitAmount: Number(b.debitAmount) || 0,
      creditAccount: String(b.creditAccount ?? ''),
      creditAmount: Number(b.creditAmount) || 0,
      narration: String(b.narration ?? ''),
    }
    await handleMutation(res, (client) => postJournal(client, input, req.session.userId ?? null))
  }),
)
