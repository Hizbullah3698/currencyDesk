import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { isAppError } from '../services/transact.js'
import { pool } from '../db/pool.js'
import { getPublicSettings, setIdleTimeoutMinutes } from '../services/settingsService.js'

export const settingsRouter = Router()

// Readable by any signed-in user, not just admins: the frontend needs the idle timeout to run its
// own countdown, and an Operator whose session is about to expire needs the warning as much as an
// Admin does. Nothing here is sensitive — it is the same number the user is about to experience.
settingsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(await getPublicSettings())
  }),
)

// Changing it is Admin-only, matching how every other configuration-shaped action in this app is
// gated (journal, salary, account mutations).
//
// Deliberately NOT routed through handleMutation: that helper's contract is "return the full
// business-data snapshot", which is right for a trade and wrong for a setting — a settings change
// alters no account, activity, cheque or journal row, and returning a snapshot would imply it had.
settingsRouter.patch(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>
    const minutes = Number(raw.idleTimeoutMinutes)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await setIdleTimeoutMinutes(client, minutes, req.session.userId ?? null)
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      if (isAppError(err)) {
        res.status(err.status).json({ error: err.message })
        return
      }
      throw err
    } finally {
      client.release()
    }

    res.json(await getPublicSettings())
  }),
)
