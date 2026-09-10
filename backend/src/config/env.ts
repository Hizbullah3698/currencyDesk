import 'dotenv/config'
// After dotenv so a local .env can exercise it, and imported HERE rather than from app.ts because
// this module is what every entry path loads first — the serverless function, the local server and
// every CLI script alike. A guard reachable from only one of those is a guard with a way around it.
import './guardPreviewDatabase.js'

// A stray leading/trailing space typed or pasted into a dashboard env var field (Vercel/Render/
// Railway all just store the raw string) is invisible in most UIs but not harmless: a cookie
// *name* with a space in it is syntactically invalid, and NODE_ENV picking up a space silently
// breaks `=== 'production'` checks — both bit this project for real during Vercel deployment,
// with no error anywhere, just a session cookie that silently never got sent. Trimming every
// value read here means that class of mistake can't happen again, regardless of which host.
function clean(value: string | undefined): string | undefined {
  return value?.trim() || undefined
}

function required(name: string): string {
  const value = clean(process.env[name])
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Copy backend/.env.example to backend/.env and fill it in.`)
  }
  return value
}

/**
 * The IANA zone the desk keeps its books in. Every server-side "today" is computed in it — see
 * config/deskTime.ts for why that is a code-level input rather than a host setting. Validated at
 * boot: an unknown zone name would otherwise surface as a thrown RangeError on the first trade.
 */
function timeZone(value: string | undefined, fallback: string): string {
  const zone = value || fallback
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone })
  } catch {
    throw new Error(`DESK_TIMEZONE "${zone}" is not a valid IANA timezone name (expected something like Asia/Karachi).`)
  }
  return zone
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  port: Number(clean(process.env.PORT)) || 3001,
  nodeEnv: clean(process.env.NODE_ENV) || 'development',
  cookieName: clean(process.env.COOKIE_NAME) || 'cd.sid',
  sessionMaxAgeDays: Number(clean(process.env.SESSION_MAX_AGE_DAYS)) || 30,
  // Optional and unset in local dev — the Vite dev proxy makes the browser see everything as
  // same-origin there, so no CORS header is needed at all. Only production, where the frontend
  // and backend are genuinely different origins, needs this set — to an explicit allowlist of
  // real origins (comma-separated, e.g. the production frontend plus a specific preview
  // deployment), never a wildcard, since credentialed (cookie-carrying) requests can't use one
  // anyway. `cors`'s array form still matches each origin exactly, no pattern/wildcard matching.
  frontendOrigins: (clean(process.env.FRONTEND_ORIGIN) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Stage 3 of the CSRF rollout (see middleware/csrf.ts). While false, a mutating request with no
  // token is allowed through and logged; while true, it is rejected. Deliberately an env flag
  // rather than a code change, so enabling it — the one step that can lock every user out if the
  // frontend rollout is incomplete — can be reverted by flipping one variable rather than by
  // shipping a rollback. Anything other than the exact string "true" is treated as false, so a
  // typo fails safe (open) rather than locking the desk out.
  csrfEnforce: clean(process.env.CSRF_ENFORCE) === 'true',
  // Defaults to the client's own zone rather than to the host's, deliberately: the host is UTC on
  // Vercel and that default is exactly what dated five hours of every desk day as yesterday.
  deskTimeZone: timeZone(clean(process.env.DESK_TIMEZONE), 'Asia/Karachi'),
}
