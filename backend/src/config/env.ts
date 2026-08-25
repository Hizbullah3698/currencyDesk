import 'dotenv/config'

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
    throw new Error(`Missing required environment variable: ${name}. Copy server/.env.example to server/.env and fill it in.`)
  }
  return value
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  port: Number(clean(process.env.PORT)) || 3001,
  nodeEnv: clean(process.env.NODE_ENV) || 'development',
  cookieName: clean(process.env.COOKIE_NAME) || 'cd.sid',
  sessionMaxAgeDays: Number(clean(process.env.SESSION_MAX_AGE_DAYS)) || 30,
}
