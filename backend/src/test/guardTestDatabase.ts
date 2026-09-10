import { env } from '../config/env.js'

// Every integration test truncates real business tables (see dbFixtures.ts's truncateAndReseedTestDb).
// `npm run test`'s `pretest`/`test` scripts always override DATABASE_URL to point at
// `currencydesk_test` before vitest even starts — but invoking `vitest run` directly (bypassing
// those npm scripts) silently falls through to backend/.env's real dev DATABASE_URL instead,
// since dotenv only fills in *missing* env vars. That happened for real once during this
// project's own Phase 4 work — a stray `npx vitest run` wiped the dev database's business data
// and leaked test users into it, requiring a manual restore. This guard makes that mistake fail
// loudly instead of silently succeeding against the wrong database.
if (!env.databaseUrl.includes('_test')) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL ("${env.databaseUrl}") doesn't look like a test database ` +
      `(expected it to contain "_test"). Run tests via "npm run test" from backend/, which points ` +
      `DATABASE_URL at the *_test database before vitest starts — never invoke vitest directly.`,
  )
}
