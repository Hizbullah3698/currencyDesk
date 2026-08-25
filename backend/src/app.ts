import express, { type ErrorRequestHandler } from 'express'
import cors from 'cors'
import { env } from './config/env.js'
import { sessionMiddleware } from './middleware/session.js'
import { authRouter } from './routes/auth.js'
import { healthRouter } from './routes/health.js'
import { stateRouter } from './routes/state.js'
import { tradesRouter } from './routes/trades.js'
import { settlementsRouter } from './routes/settlements.js'
import { chequesRouter } from './routes/cheques.js'
import { journalRouter } from './routes/journal.js'
import { salaryRouter } from './routes/salary.js'
import { accountsRouter } from './routes/accounts.js'

export function createApp() {
  const app = express()

  // Every deployment target (Vercel, Render, Railway) puts exactly one reverse proxy in front of
  // this app, which sets X-Forwarded-For to the real client IP. Without telling Express to trust
  // that one hop, req.ip resolves to the proxy's own address (useless for express-rate-limit's
  // per-client keying) — and express-rate-limit v7 throws rather than silently keying on the
  // wrong IP, which is what actually crashed every request through loginLimiter on Vercel.
  // `1` (not `true`) trusts only the immediate hop, not an arbitrary chain of proxies.
  app.set('trust proxy', 1)

  // Unset in local dev (the Vite dev proxy makes the browser see everything as same-origin, so
  // no CORS is needed at all there). In production, the frontend and backend are genuinely
  // different origins — allowlisted to exactly that one real origin, never a wildcard, since a
  // wildcard can't be combined with credentials: true anyway (the whole point of a session
  // cookie is that it's credentialed).
  if (env.frontendOrigin) {
    app.use(cors({ origin: env.frontendOrigin, credentials: true }))
  }

  app.use(express.json())
  app.use(sessionMiddleware)

  app.use('/api', healthRouter)
  app.use('/api/auth', authRouter)
  app.use('/api/state', stateRouter)
  app.use('/api/trades', tradesRouter)
  app.use('/api/settlements', settlementsRouter)
  app.use('/api/cheques', chequesRouter)
  app.use('/api/journal', journalRouter)
  app.use('/api/salary', salaryRouter)
  app.use('/api/accounts', accountsRouter)

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error(err)
    if (res.headersSent) return
    res.status(500).json({ error: 'Something went wrong.' })
  }
  app.use(errorHandler)

  return app
}

// Vercel's native Express support scans for a conventionally-named app.js and specifically
// requires ITS default export to be the app/server — independent of, and in addition to, the
// api/index.ts entry point. The named createApp() factory above stays the primary export (used
// by src/index.ts for local/Railway/Render's persistent-process model, and by the test suite to
// construct an independent instance per test file) — this default export exists only to satisfy
// Vercel's own convention-based detection of this specific file.
export default createApp()
