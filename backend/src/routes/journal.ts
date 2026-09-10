import { Router } from 'express'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { handleMutation, sendIfAppError } from '../services/transact.js'
import { postJournal, type JournalInput } from '../services/journalService.js'
import { parseTxnDate } from './txnDate.js'

export const journalRouter = Router()

journalRouter.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    let input: JournalInput
    try {
      input = {
        debitAccount: String(b.debitAccount ?? ''),
        debitAmount: Number(b.debitAmount) || 0,
        creditAccount: String(b.creditAccount ?? ''),
        creditAmount: Number(b.creditAmount) || 0,
        narration: String(b.narration ?? ''),
        // Same validator, same terms as a trade's date — see routes/txnDate.ts. Optional: the
        // Journal page does not send one yet, and the service then dates the entry on the desk's
        // own today rather than the database's.
        txnDate: parseTxnDate(b.txnDate),
      }
    } catch (err) {
      if (sendIfAppError(res, err)) return
      throw err
    }
    await handleMutation(res, req, (client) => postJournal(client, input, req.session.userId ?? null))
  }),
)
