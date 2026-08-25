import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import { pool } from '../db/pool.js'
import { env } from '../config/env.js'

const PgSession = connectPgSimple(session)

const isProduction = env.nodeEnv === 'production'

export const sessionMiddleware = session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: false }),
  name: env.cookieName,
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    // Local dev is plain http://localhost, where `secure: true` would silently stop the browser
    // from ever sending the cookie back at all. In production, the frontend and backend are on
    // two different domains (Vercel projects), not same-origin behind a dev proxy — a
    // cross-origin fetch only carries the cookie if it's SameSite=None, and browsers refuse to
    // honor SameSite=None without secure:true, so these two only make sense set together.
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    maxAge: env.sessionMaxAgeDays * 24 * 60 * 60 * 1000,
  },
})
