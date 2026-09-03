// Reconciliation harness runner — requirement 7, phase 2.
//
//   cd backend  && npm run snapshot:dump           (or snapshot:dump:prod)
//   cd frontend && npm run reconcile
//
// Deliberately a script with a verdict and an exit code rather than a vitest test, matching the
// pattern `npm run csrf:gate` already established here for the same reason: it answers a question
// about live data at a moment in time, and it is EXPECTED TO FAIL until requirement 7 is finished.
// Wiring a knowingly-red check into `npm run test` would train everyone to ignore a red suite.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { reconcile, reconciliationDates, TOLERANCE, type ReconResult, type Snapshot } from '../src/lib/reconcile'

const DEFAULT_DUMP = resolve(process.cwd(), '..', 'backend', 'snapshot.json')

const pkr = (n: number) =>
  (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function pad(s: string, w: number) {
  return s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w)
}
function padL(s: string, w: number) {
  return s.length > w ? s.slice(0, w - 1) + '…' : s.padStart(w)
}

function report(r: ReconResult, label: string): void {
  const head = `${label}  ·  as at ${r.asOf}`
  console.log('\n' + head)
  console.log('─'.repeat(Math.max(head.length, 96)))

  if (r.ok) {
    console.log('  every account agrees — journal-only matches what the app reports')
    return
  }

  console.log(
    '  ' + pad('Account', 30) + pad('Type', 16) + padL('Reported', 16) + padL('Journal only', 16) + padL('Difference', 16),
  )
  for (const row of r.mismatched.slice(0, 14)) {
    console.log(
      '  ' + pad(row.label, 30) + pad(row.type, 16) + padL(pkr(row.current), 16) + padL(pkr(row.journal), 16) + padL(pkr(row.delta), 16),
    )
  }
  if (r.mismatched.length > 14) console.log(`  … and ${r.mismatched.length - 14} more`)

  const bySource = new Map<string, number>()
  for (const row of r.mismatched) bySource.set(row.source, (bySource.get(row.source) || 0) + Math.abs(row.delta))
  console.log('\n  Attributed to:')
  for (const [source, amount] of [...bySource].sort((a, b) => b[1] - a[1])) {
    console.log('    ' + pad(source, 34) + padL(pkr(amount), 18))
  }
  console.log(`\n  ${r.mismatched.length} of ${r.rows.length} accounts disagree · total drift PKR ${pkr(r.totalDrift)}`)
}

function main(): void {
  const path = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_DUMP
  if (!existsSync(path)) {
    console.error(`No snapshot at ${path}`)
    console.error('Take one first:  cd backend && npm run snapshot:dump     (or snapshot:dump:prod)')
    process.exit(2)
  }

  const snap = JSON.parse(readFileSync(path, 'utf8')) as Snapshot
  console.log('Journal reconciliation — does a journal-only balance sheet match what the app reports?')
  console.log(`Snapshot: ${path}`)
  console.log(
    `  ${snap.accounts.length} accounts · ${snap.activity.length} activity rows · ${snap.journalEntries.length} journal entries · tolerance PKR ${TOLERANCE}`,
  )

  const dates = reconciliationDates(snap)
  const results = dates.map((d) => ({ d, r: reconcile(snap, d.t) }))
  for (const { d, r } of results) report(r, d.label)

  const failed = results.filter(({ r }) => !r.ok)
  console.log('\n' + '═'.repeat(96))
  if (failed.length === 0) {
    console.log('VERDICT: RECONCILED — the journal alone reproduces every reported figure, at every date checked.')
    process.exit(0)
  }

  const worst = Math.max(...failed.map(({ r }) => r.worst))
  console.log(`VERDICT: NOT RECONCILED — ${failed.length} of ${results.length} dates disagree, largest single gap PKR ${pkr(worst)}.`)
  console.log('Vouchers are posted live and history is backfilled, so this is NO LONGER a blanket')
  console.log('expected gap. Attribute every remaining difference to a specific cause before')
  console.log('accepting it.')
  console.log('')
  console.log('One known cause, logged 2026-09-02 and left to phase 5: computeBalanceSheet reads a')
  console.log('customer’s stored receivable/payable columns with no asOfT, so it reports the')
  console.log('CURRENT balance at every historical date. Its signature is a Customer row whose')
  console.log('Reported figure is identical at every date while Journal only moves — there the')
  console.log('journal is right and the report is wrong.')
  console.log('')
  console.log('Anything not matching that signature is unexplained. Treat it as a finding.')
  process.exit(1)
}

main()
