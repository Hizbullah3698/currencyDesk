import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import { pool } from '../db/pool.js'
import { env } from '../config/env.js'

const PgSession = connectPgSimple(session)

export const sessionMiddleware = session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: false }),
  name: env.cookieName,
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: false, // local dev over http://localhost only — flip to true behind HTTPS in production
    sameSite: 'lax',
    path: '/',
    maxAge: env.sessionMaxAgeDays * 24 * 60 * 60 * 1000,
  },
})
