import { appError } from '../services/transact.js'

/**
 * Upper bound for any money or rate field arriving in a request body.
 *
 * One trillion. Every `numeric` column these values land in holds far more than this
 * (`numeric(18,2)` → 10^16, `numeric(18,4)` → 10^14, `numeric(18,6)` → 10^12), and no real
 * desk figure comes within three orders of magnitude of it. Its job is only to turn an absurd
 * input — `1e400`, which `Number()` parses to `Infinity` and which passes every `> 0` check —
 * into a clean 400 instead of a Postgres "numeric field overflow" surfacing as a raw 500.
 */
export const MAX_INPUT_AMOUNT = 1e12

/**
 * Parses a numeric request field. `NaN`, a missing value and any non-positive number all become
 * `0` — the service layer then rejects that with its own "enter an amount greater than 0" 400,
 * so callers keep their existing `Number(x) || 0` behaviour. What is new is that a non-finite or
 * over-cap value throws `appError(400)` here rather than reaching the database.
 *
 * Runs during body parsing, before any transaction opens, so the route must catch it with
 * `sendIfAppError` (trades/settlements/journal already do).
 */
export function parseAmount(raw: unknown, field: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    if (raw === undefined || raw === null || raw === '' || Number.isNaN(n)) return 0
    throw appError(400, `${field} is not a valid number.`)
  }
  if (n > MAX_INPUT_AMOUNT) {
    throw appError(400, `${field} is too large.`)
  }
  return n > 0 ? n : 0
}
