import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { getSnapshot, viewForRole } from '../services/stateService.js'

export const stateRouter = Router()

// Any signed-in role sees the business data it needs to operate the desk, but the snapshot is
// filtered to the caller's role — per-deal cost and realised margin are Admin-only, matching the
// gating the UI already applies to /income-statement and the Stock currency ledger. See
// SnapshotView in stateService.ts for what that does and does not achieve.
stateRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const snapshot = await getSnapshot(pool, viewForRole(req.session.role))
    res.json(snapshot)
  }),
)
