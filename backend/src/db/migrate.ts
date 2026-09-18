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

// Which database is this actually pointed at? Printed on every run, because the whole risk of a
// migration is running it somewhere you did not mean to — and against production there is no undo.
// Same reporting as resetBusinessData.ts, for the same reason.
function target(): string {
  try {
    const u = new URL(process.env.DATABASE_URL || '')
    return `${u.pathname.replace(/^\//, '') || '(unknown)'} @ ${u.host}`
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

async function run() {
  // --dry-run reports what WOULD be applied and changes nothing, not even schema_migrations.
  // It exists for the production path: `npm run migrate:prod:check` is how you find out what a
  // release is about to do to the live schema BEFORE it does it. Structural changes must land
  // before the software that depends on them, and that is only safe if you know what they are.
  const dryRun = process.argv.includes('--dry-run')

  console.log(`migrate  ${target()}`)
  console.log(`mode     ${dryRun ? 'DRY RUN — nothing will be applied' : 'APPLY'}\n`)

  if (dryRun) {
    // A database that has never been migrated has no schema_migrations table, and a dry run must
    // not create one — so treat "missing table" as "nothing applied yet" rather than erroring.
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql') || f.endsWith('.ts'))
      .sort()
    let applied = new Set<string>()
    try {
      const { rows } = await pool.query('SELECT name FROM schema_migrations')
      applied = new Set(rows.map((r) => r.name as string))
    } catch {
      console.log('schema_migrations does not exist — this database has never been migrated.\n')
    }
    const pending = files.filter((f) => !applied.has(f))
    files.forEach((f) => console.log(`${applied.has(f) ? 'applied ' : 'PENDING '} ${f}`))
    console.log(
      pending.length === 0
        ? '\nUp to date — nothing pending.'
        : `\n${pending.length} pending. Nothing was applied; re-run without --dry-run to apply.`,
    )
    await pool.end()
    return
  }

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
