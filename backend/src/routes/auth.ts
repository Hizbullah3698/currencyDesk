import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { attemptLogin } from '../services/authService.js'
import { findUserById, toPublicUser } from '../services/userService.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { env } from '../config/env.js'
import { pool } from '../db/pool.js'
import { PostgresRateLimitStore } from '../services/rateLimitStore.js'

export const authRouter = Router()

// A Postgres-backed store, not the default in-memory one — see rateLimitStore.ts for why: this
// limit must hold even when multiple separate server instances (e.g. serverless function
// invocations) are running concurrently, each with its own process memory.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
  store: new PostgresRateLimitStore(pool),
})

authRouter.post('/login', loginLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' })
    return
  }

  const result = await attemptLogin(email, password)
  if (!result.ok) {
    res.status(result.status).json({ error: result.error })
    return
  }

  // Regenerate the session id on login (before storing any identity in it) to prevent
  // session fixation — a pre-login session id is never reused as a post-login one.
  req.session.regenerate((err) => {
    if (err) {
      res.status(500).json({ error: 'Could not start a session.' })
      return
    }
    req.session.userId = result.user.id
    req.session.role = result.user.role
    res.json({ user: result.user })
  })
})

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie(env.cookieName)
    res.status(204).end()
  })
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await findUserById(req.session.userId!)
  if (!user) {
    res.status(401).json({ error: 'Not authenticated.' })
    return
  }
  res.json({ user: toPublicUser(user) })
})
