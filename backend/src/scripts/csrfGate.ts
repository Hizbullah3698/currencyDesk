import { pool } from '../db/pool.js'
import { env } from '../config/env.js'

// ---------------------------------------------------------------------------
// Is it safe to switch on CSRF_ENFORCE (rollout stage 3)?
// ---------------------------------------------------------------------------
//
// Turns the stage-3 go/no-go into an observation rather than a judgement call. Run it against the
// database the target environment uses:
//
//   npm run csrf:gate                 # whatever DATABASE_URL resolves to (local dev by default)
//   DATABASE_URL=<production> npm run csrf:gate
//
// The question it answers is NOT simply "is the table empty". An empty table also describes a desk
// nobody has used, which is not evidence of anything. So it reports the failures alongside the
// real business traffic over the same window — if trades were posted and none of them lacked a
// token, that is a green light. If nothing was posted at all, the correct answer is "come back
// later", and it says so rather than giving a false all-clear.
// ---------------------------------------------------------------------------

const HOURS = Number(process.argv[2]) || 48

/**
 * Host and database name only — never the credentials. Printed on every run because a verdict is
 * only meaningful if you know which database produced it, and the two invocations
 * (`csrf:gate` for local, `csrf:gate:prod` for production) differ only by an env var that is easy
 * to forget. Acting on a green light from the wrong database is the mistake this line prevents.
 */
function describeTarget(): string {
  const m = env.databaseUrl.match(/@([^/?]+)\/([^?]*)/)
  return m ? `${m[2]} @ ${m[1]}` : '(unrecognised connection string)'
}

async function run() {
  // The window MUST NOT extend back beyond the moment this table started being written, or the
  // check compares a numerator with no history against a denominator with plenty and reports a
  // confident green light off the back of it. That is precisely the mismatched-window mistake this
  // script exists to replace, and it produced a false SAFE the first time this ran in production —
  // zero failures because the table was minutes old, against four business writes from the
  // preceding two days, one of which is known to have carried no token.
  const { rows: applied } = await pool.query<{ applied_at: Date }>(
    `SELECT applied_at FROM schema_migrations WHERE name = '013_create_csrf_missing_token.sql'`,
  )
  if (applied.length === 0) {
    console.error('\n  ✗ csrf_missing_token has never been created on this database — run `npm run migrate` first.\n')
    process.exitCode = 1
    await pool.end()
    return
  }
  const recordingSince = applied[0].applied_at

  const { rows: window } = await pool.query<{ since: Date; hours: number; clamped: boolean }>(
    `SELECT GREATEST(now() - ($1 || ' hours')::interval, $2::timestamptz) AS since,
            EXTRACT(EPOCH FROM (now() - GREATEST(now() - ($1 || ' hours')::interval, $2::timestamptz))) / 3600 AS hours,
            (now() - ($1 || ' hours')::interval) < $2::timestamptz AS clamped`,
    [HOURS, recordingSince],
  )
  const since = window[0].since
  const effectiveHours = Number(window[0].hours)
  const clamped = window[0].clamped

  const { rows: missing } = await pool.query<{
    total: number
    users: number
    paths: string
    latest: Date | null
  }>(
    `SELECT COALESCE(SUM(count), 0)::int      AS total,
            COUNT(DISTINCT user_id)::int      AS users,
            COALESCE(string_agg(DISTINCT method || ' ' || path, ', '), '') AS paths,
            MAX(last_seen)                    AS latest
       FROM csrf_missing_token
      WHERE last_seen > $1`,
    [since],
  )

  // Counted over the SAME window, so the two figures are comparable.
  const { rows: traffic } = await pool.query<{ activity: number; journal: number }>(
    `SELECT (SELECT count(*) FROM activity        WHERE created_at > $1)::int AS activity,
            (SELECT count(*) FROM journal_entries WHERE created_at > $1)::int AS journal`,
    [since],
  )

  const m = missing[0]
  const t = traffic[0]
  const mutationsSeen = t.activity + t.journal

  console.log(`\nCSRF stage-3 gate — last ${HOURS}h requested`)
  console.log('─'.repeat(52))
  console.log(`  database checked             : ${describeTarget()}`)
  console.log(`  window actually measured     : ${effectiveHours.toFixed(1)}h, since ${since.toISOString()}`)
  if (clamped) {
    console.log(`  (clamped — recording only began ${recordingSince.toISOString()};`)
    console.log(`   nothing before that can be known either way)`)
  }
  console.log(`  enforcement currently        : ${env.csrfEnforce ? 'ON' : 'off'}`)
  console.log(`  requests missing a token     : ${m.total}${m.total > 0 ? `  (${m.users} user(s))` : ''}`)
  if (m.total > 0) {
    console.log(`  where                        : ${m.paths}`)
    console.log(`  most recent                  : ${m.latest?.toISOString()}`)
  }
  console.log(`  real business writes in window: ${mutationsSeen}  (${t.activity} trades/settlements, ${t.journal} journal entries)`)
  console.log('─'.repeat(52))

  if (m.total > 0) {
    console.log('  ✗ NOT SAFE — something is still sending mutating requests without a token.')
    console.log('    Switching enforcement on now would reject those requests. Most likely a')
    console.log('    browser still running a cached copy of the frontend; give it longer, or')
    console.log('    identify the user above and have them reload.')
    process.exitCode = 1
  } else if (mutationsSeen === 0) {
    console.log('  ? INCONCLUSIVE — no untokened requests, but no real usage either.')
    console.log('    An empty result from an idle desk is not evidence of anything. Re-run once')
    console.log('    the desk has actually been used.')
    if (clamped) {
      console.log(`    Note: only ${effectiveHours.toFixed(1)}h of history exists so far, so a wider`)
      console.log('    window would not help yet — the recording simply has not been running long.')
    }
    process.exitCode = 2
  } else {
    console.log('  ✓ SAFE — real traffic occurred and every mutating request carried a token.')
    console.log('    Set CSRF_ENFORCE=true on the backend project and redeploy.')
  }
  console.log()

  await pool.end()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
