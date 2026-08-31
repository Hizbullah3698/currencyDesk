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

async function run() {
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
      WHERE last_seen > now() - ($1 || ' hours')::interval`,
    [HOURS],
  )

  const { rows: traffic } = await pool.query<{ activity: number; journal: number }>(
    `SELECT (SELECT count(*) FROM activity        WHERE created_at > now() - ($1 || ' hours')::interval)::int AS activity,
            (SELECT count(*) FROM journal_entries WHERE created_at > now() - ($1 || ' hours')::interval)::int AS journal`,
    [HOURS],
  )

  const m = missing[0]
  const t = traffic[0]
  const mutationsSeen = t.activity + t.journal

  console.log(`\nCSRF stage-3 gate — last ${HOURS}h`)
  console.log('─'.repeat(52))
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
    console.log('    An empty result from an idle desk is not evidence. Re-run after the desk')
    console.log('    has been used, or widen the window:  npm run csrf:gate -- 168')
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
