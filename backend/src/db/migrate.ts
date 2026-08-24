import { readdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import type { PoolClient } from 'pg'
import { pool } from './pool.js'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

// Most migrations are plain .sql. A migration needs to be .ts instead of .sql only when its
// content must be derived from TypeScript source rather than hand-duplicated in SQL — e.g.
// 009_lock_core_accounts.ts builds its trigger body from @currencydesk/engine's
// CORE_ACCOUNT_IDS so there is exactly one place that list is ever written down.
interface TsMigration {
  up: (client: PoolClient) => Promise<void>
}

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') || f.endsWith('.ts'))
    .sort()

  const { rows } = await pool.query('SELECT name FROM schema_migrations')
  const applied = new Set(rows.map((r) => r.name as string))

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`)
      continue
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      if (file.endsWith('.sql')) {
        const sql = readFileSync(join(migrationsDir, file), 'utf8')
        await client.query(sql)
      } else {
        const mod = (await import(pathToFileURL(join(migrationsDir, file)).href)) as TsMigration
        await mod.up(client)
      }
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
      console.log(`apply ${file}`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
    } finally {
      client.release()
    }
  }

  await pool.end()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
