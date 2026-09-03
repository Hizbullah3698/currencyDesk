import { pool } from '../db/pool.js'
import { backfillVouchers } from '../services/voucherBackfill.js'

// CLI wrapper around services/voucherBackfill.ts — connection, transaction, formatting. The logic
// lives in the service so it can be tested; see test/integration/voucherBackfill.test.ts, which
// covers the skip reporting specifically. That reporting is what a person reads before typing
// --apply, so a right decision reported wrongly would make a dry run look clean when it is not.
//
// DRY RUN BY DEFAULT. It does the whole thing, prints what it would write, then rolls back unless
// given --apply. A script that writes to the real books should not do so because someone typed the
// command; it should do so because someone read the plan first and then said yes.
//
//   npm run backfill:vouchers                 dev, dry run
//   npm run backfill:vouchers -- --apply      dev, commits
//   npm run backfill:vouchers:prod            production, dry run
//
// ROLLBACK, if one is ever needed after --apply: every row this writes carries a voucher_id, so
// `DELETE FROM journal_entries WHERE voucher_id IS NOT NULL AND created_at >= '<the run>'` undoes
// it exactly. Nothing else is modified, so there is nothing else to restore.
//
// EXPECT JV NUMBERS TO JUMP. Each leg takes its own ref from journal_ref_seq, so a backfill of any
// size consumes a block of them and manual entries posted afterwards continue from a much higher
// number. Cosmetic — voucher legs do not surface their refs — but it looks like data loss if you do
// not know to expect it.

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL || '').host
    } catch {
      return 'unknown host'
    }
  })()

  console.log('Voucher backfill — requirement 7, phase 4')
  console.log(`  database   ${host}`)
  console.log(`  mode       ${apply ? 'APPLY — changes will be committed' : 'DRY RUN — everything rolls back'}`)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const report = await backfillVouchers(client, null)

    console.log('\nOpening currency stock')
    for (const o of report.opening) {
      const line = `  ${o.code.padEnd(5)}${o.qty.toLocaleString('en-US').padStart(14)} @ ${o.avgCost.toFixed(6).padStart(14)}  =  ${o.value.toFixed(2).padStart(16)}`
      console.log(o.posted ? `${line}   posted ${o.txnDate}` : `${line}   skipped (${o.skipped})`)
    }

    for (const [title, pass] of [
      ['Deals', report.activity],
      ['Cleared cheques', report.cheques],
    ] as const) {
      console.log(`\n${title}`)
      console.log(`  considered ${pass.considered}`)
      console.log(`  posted     ${pass.posted} vouchers, ${pass.legs} legs`)
      if (pass.skipped.length === 0) console.log('  skipped    none')
      for (const s of pass.skipped) console.log(`  skipped    ${s.id.slice(0, 8)}  ${s.why}`)
    }

    if (apply) {
      await client.query('COMMIT')
      console.log('\nCOMMITTED.')
      console.log('Run the reconciliation harness now — it is the acceptance test for this work:')
      console.log('  cd backend && npm run snapshot:dump   then   cd frontend && npm run reconcile')
    } else {
      await client.query('ROLLBACK')
      console.log('\nROLLED BACK — nothing was written. Re-run with --apply to commit.')
    }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nFAILED, rolled back. Nothing was written.')
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
