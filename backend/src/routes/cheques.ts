import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { handleMutation } from '../services/transact.js'
import { depositCheque, clearCheque, returnCheque, cancelCheque } from '../services/chequeService.js'

export const chequesRouter = Router()

// Deposit is available to any signed-in role; clearing and returning require Admin — matches
// the existing frontend's own gating (TopBar's restricted-access banner names this split
// explicitly, and Cheques.tsx checks isAdmin before offering clear/return).
chequesRouter.post(
  '/:id/deposit',
  requireAuth,
  asyncHandler(async (req, res) => {
    await handleMutation(res, req, (client) => depositCheque(client, req.params.id, req.session.userId ?? null))
  }),
)

chequesRouter.post(
  '/:id/clear',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await handleMutation(res, req, (client) => clearCheque(client, req.params.id, req.session.userId ?? null))
  }),
)

// Cancelling is a correction to the record rather than a step in the cheque's life, so it sits
// with clearing and returning on the Admin side — the same split TopBar's restricted-access banner
// already describes. An operator who mis-keys a cheque asks an admin to void it.
chequesRouter.post(
  '/:id/cancel',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await handleMutation(res, req, (client) => cancelCheque(client, req.params.id, req.session.userId ?? null))
  }),
)

chequesRouter.post(
  '/:id/return',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await handleMutation(res, req, (client) => returnCheque(client, req.params.id, req.session.userId ?? null))
  }),
)
