import pg from 'pg'
import { env } from '../config/env.js'

// pg's defaults return `numeric` columns as strings (to avoid silent precision loss) and
// `date` columns as JS Date objects (which then get timezone-shifted on stringification). This
// app's existing business logic (engine.ts) has always worked in plain JS numbers/ISO strings,
// so these two overrides make Postgres match that, not improve on it — every numeric column
// comes back as a real number, and `date` columns come back as the literal 'YYYY-MM-DD' text
// Postgres already holds, with no implicit timezone conversion.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (val) => parseFloat(val))
pg.types.setTypeParser(pg.types.builtins.DATE, (val) => val)

export const pool = new pg.Pool({ connectionString: env.databaseUrl })

pool.on('error', (err) => {
  // A background/idle client emitting an error should not crash the process —
  // log and let the pool recycle the connection.
  console.error('Unexpected error on idle Postgres client', err)
})
