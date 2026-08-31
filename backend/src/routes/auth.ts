import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { attemptLogin } from '../services/authService.js'
import { findUserById, toPublicUser } from '../services/userService.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { issueCsrfToken } from '../middleware/csrf.js'
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
  // Accepts `identifier` (email or username). `email` is still read as a fallback so an
  // older cached frontend bundle keeps working against a newly deployed backend — the two
  // are deployed separately, so they are briefly out of step on every release.
  const raw = typeof req.body?.identifier === 'string' ? req.body.identifier : typeof req.body?.email === 'string' ? req.body.email : ''
  const identifier = raw.trim()
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!identifier || !password) {
    res.status(400).json({ error: 'Username and password are required.' })
    return
  }

  const result = await attemptLogin(identifier, password)
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
    // Minted after regenerate(), so the token belongs to the post-login session id and a
    // pre-login token can never carry over. Returned in the body rather than a cookie: the SPA
    // holds it in memory and echoes it as X-CSRF-Token — see middleware/csrf.ts for why a
    // readable double-submit cookie is the wrong shape for this two-origin deployment.
    res.json({ user: result.user, csrfToken: issueCsrfToken(req) })
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
  // The token comes back here too, not only from /login. This is the call a returning user makes
  // on every boot without re-authenticating, so it is the only way a session created before this
  // middleware shipped can acquire a token — which is what stops stage 3 signing those users out.
  res.json({ user: toPublicUser(user), csrfToken: issueCsrfToken(req) })
})
