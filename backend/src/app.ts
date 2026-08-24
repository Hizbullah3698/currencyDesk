import express, { type ErrorRequestHandler } from 'express'
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
