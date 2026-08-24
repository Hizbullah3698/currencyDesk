import pg from 'pg'
import { env } from '../config/env.js'

// Runs as `pretest`, pointed at the test DATABASE_URL (see package.json's `test`/`pretest`
// scripts) — creates that database if it doesn't exist yet, by connecting to the `postgres`
// maintenance database with the same credentials. The `currencydesk` role is the container's
// POSTGRES_USER (see docker-compose.yml), which Postgres's own image makes a superuser, so it
// already has CREATEDB rights — no separate test-only role or grant is needed.
async function main() {
  const target = new URL(env.databaseUrl)
  const dbName = target.pathname.slice(1)
  if (!dbName) throw new Error(`DATABASE_URL has no database name: ${env.databaseUrl}`)

  const adminUrl = new URL(env.databaseUrl)
  adminUrl.pathname = '/postgres'
  const client = new pg.Client({ connectionString: adminUrl.toString() })
  await client.connect()
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (rows.length === 0) {
      // Database identifiers can't be parameterized — safe here because dbName comes from our
      // own DATABASE_URL env var, not user input.
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`)
      console.log(`Created test database "${dbName}"`)
    } else {
      console.log(`Test database "${dbName}" already exists`)
    }
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
