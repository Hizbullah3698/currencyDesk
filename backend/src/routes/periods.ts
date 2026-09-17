import { Router } from 'express'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { handleMutation } from '../services/transact.js'
import { closePeriod, reopenPeriod } from '../services/periodsService.js'

export const periodsRouter = Router()

periodsRouter.post(
  '/:id/close',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await handleMutation(res, req, (client) => closePeriod(client, req.params.id, req.session.userId ?? null))
  }),
)

periodsRouter.post(
  '/:id/reopen',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await handleMutation(res, req, (client) => reopenPeriod(client, req.params.id, req.session.userId ?? null))
  }),
)
