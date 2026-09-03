import { pool } from '../db/pool.js'
import { resetBusinessDataForGoLive } from '../services/businessDataReset.js'

// CLI for clearing the desk back to blank books before the client trades for real.
//
//   npm run reset:business                                        dry run
//   npm run reset:business -- --apply --confirm=<database name>   commits
//
// TWO GATES, NOT ONE. The backfill needs only --apply because it is additive: worst case it writes
// rows that can be deleted again. This is destructive, so it also requires naming the database it
// is pointed at, and refuses if the name does not match the one it is actually connected to. The
// point is not ceremony — it is that "I ran it against the wrong database" becomes something you
// have to type your way into rather than something you can do by having the wrong terminal focused.
//
// It reports what it would remove, including WHICH accounts by name, and rolls back unless both
// gates are given. The assertions in the service run before the caller commits, so a result that
// failed any of them is never visible.

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const confirm = arg('confirm')

  let host = 'unknown host'
  let dbName = ''
  try {
    const u = new URL(process.env.DATABASE_URL || '')
    host = u.host
    dbName = u.pathname.replace(/^\//, '')
  } catch {
    /* reported below */
  }

  console.log('Clear the desk — remove practice data before go-live')
  console.log(`  database   ${dbName || '(unknown)'} @ ${host}`)
  console.log(`  mode       ${apply ? 'APPLY — changes will be committed' : 'DRY RUN — everything rolls back'}`)

  if (apply && confirm !== dbName) {
    console.error('')
    console.error(`REFUSED. --apply also requires --confirm=${dbName || '<database name>'}`)
    console.error(confirm ? `  you passed --confirm=${confirm}, which is not the database this is connected to.` : '  no --confirm was given.')
    console.error('  This is destructive. Naming the database is how "wrong database" stops being an accident.')
    await pool.end()
    process.exit(2)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await resetBusinessDataForGoLive(client)

    console.log('\nRemoved')
    console.log(`  accounting entries   ${String(r.deleted.journalEntries).padStart(6)}   (was ${r.before.journalEntries})`)
    console.log(`  deals                ${String(r.deleted.activity).padStart(6)}   (was ${r.before.activity})`)
    console.log(`  cheques              ${String(r.deleted.cheques).padStart(6)}   (was ${r.before.cheques})`)
    console.log(`  accounts             ${String(r.deleted.nonSystemAccounts).padStart(6)}   (was ${r.before.nonSystemAccounts})`)
    for (const a of r.removedAccounts) console.log(`      - ${a.type.padEnd(10)} ${a.name}`)

    console.log('\nReset')
    console.log(`  currency positions zeroed   ${r.deleted.stockPositionsZeroed} rows (kept, not deleted)`)
    console.log('  entry and cheque numbering restarted at 1')

    console.log('\nChecks (run before committing — any failure rolls everything back)')
    for (const c of r.checks) {
      console.log(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.what.padEnd(38)} expected ${c.expected.padEnd(16)} actual ${c.actual}`)
    }

    const failed = r.checks.filter((c) => !c.ok)
    if (failed.length > 0) {
      await client.query('ROLLBACK')
      console.error(`\nROLLED BACK — ${failed.length} check(s) failed. Nothing was changed.`)
      process.exitCode = 1
      return
    }

    if (apply) {
      await client.query('COMMIT')
      console.log('\nCOMMITTED. The desk is clear.')
      console.log('Real logins are created separately with `npm run create-user` — this script does not touch them.')
    } else {
      await client.query('ROLLBACK')
      console.log('\nROLLED BACK — nothing was changed. Re-run with --apply --confirm=' + dbName + ' to commit.')
    }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nFAILED, rolled back. Nothing was changed.')
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
