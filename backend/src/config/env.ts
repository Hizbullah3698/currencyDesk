import 'dotenv/config'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Copy server/.env.example to server/.env and fill it in.`)
  }
  return value
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  cookieName: process.env.COOKIE_NAME || 'cd.sid',
  sessionMaxAgeDays: Number(process.env.SESSION_MAX_AGE_DAYS) || 30,
}
