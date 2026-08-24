import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { handleMutation } from '../services/transact.js'
import { depositCheque, clearCheque, returnCheque } from '../services/chequeService.js'

export const chequesRouter = Router()

// Deposit is available to any signed-in role; clearing and returning require Admin — matches
// the existing frontend's own gating (TopBar's restricted-access banner names this split
// explicitly, and Cheques.tsx checks isAdmin before offering clear/return).
chequesRouter.post(
  '/:id/deposit',
  requireAuth,
  asyncHandler(async (req, res) => {
    await handleMutation(res, (client) => depositCheque(client, req.params.id, req.session.userId ?? null))
  }),
)

chequesRouter.post(
  '/:id/clear',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await handleMutation(res, (client) => clearCheque(client, req.params.id, req.session.userId ?? null))
  }),
)

chequesRouter.post(
  '/:id/return',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await handleMutation(res, (client) => returnCheque(client, req.params.id, req.session.userId ?? null))
  }),
)
