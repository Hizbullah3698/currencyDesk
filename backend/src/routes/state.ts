import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { getSnapshot } from '../services/stateService.js'

export const stateRouter = Router()

// Any signed-in role sees all business data — matches the existing app's actual behavior
// exactly (role-based gating has always been which pages/actions render, never which data the
// client holds; see CLAUDE.md's "Roles" section).
stateRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const snapshot = await getSnapshot(pool)
    res.json(snapshot)
  }),
)
