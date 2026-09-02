import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pool } from '../db/pool.js'
import { getSnapshot, viewForRole } from '../services/stateService.js'

// Writes the full state snapshot to a JSON file, so the reconciliation harness in the frontend
// workspace can run against real data.
//
// WHY A DUMP RATHER THAN THE HARNESS READING THE DATABASE ITSELF. The harness has to compare a
// journal-derived balance sheet against the one the app actually reports, and the app's version
// is computeBalanceSheet() in frontend/src/lib/reports.ts. The backend cannot import from the
// frontend, and moving that math into the shared engine to satisfy a test would mean rewriting
// load-bearing accounting code for the convenience of the thing meant to be checking it. A JSON
// dump keeps the harness running the identical function the Balance Sheet page renders, with the
// identical data, and leaves reports.ts untouched.
//
// The dump is taken with the ADMIN view deliberately. The harness reconciles the real books; a
// filtered snapshot would be missing exactly the Income legs whose treatment is most at risk.
// It therefore contains cost and margin figures — it is written to a gitignored path and is not
// something to leave lying in a shared directory.

async function run(): Promise<void> {
  const target = process.argv[2] || 'snapshot.json'
  const path = resolve(process.cwd(), target)

  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL || '').host
    } catch {
      return 'unknown host'
    }
  })()

  const snapshot = await getSnapshot(pool, viewForRole('admin'))
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf8')

  console.log(`Snapshot written to ${path}`)
  console.log(`  source        ${host}`)
  console.log(`  accounts      ${snapshot.accounts.length}`)
  console.log(`  activity      ${snapshot.activity.length}`)
  console.log(`  cheques       ${snapshot.cheques.length}`)
  console.log(`  journal       ${snapshot.journalEntries.length}`)
  console.log(`  stock codes   ${Object.keys(snapshot.stocks).length}`)

  await pool.end()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
