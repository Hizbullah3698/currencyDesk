import { appError } from '../services/transact.js'
import { deskToday } from '../config/deskTime.js'

// The earliest date the desk will accept as a deal date. Not a business rule the client asked
// for so much as a typo guard: '0202-08-14' parses fine as a real calendar date and would
// silently land 1,800 years in the past on every report that cuts on txn_date.
const MIN_TXN_DATE = '2000-01-01'

/**
 * Validates the optional `txnDate` on a trade/settlement/journal request body and returns it as a
 * plain 'YYYY-MM-DD' string, or `null` when it is absent/blank (the service then dates the row
 * with the desk's own today — see config/deskTime.ts).
 *
 * Deliberately strict about the FORMAT rather than handing the string to `new Date()`: Date's
 * parser accepts far more than the contract allows ('2026-8-4', 'Aug 4 2026', '2026-08-04T…')
 * and resolves a bare 'YYYY-MM-DD' as UTC, which in a negative-offset zone is the previous local
 * day. The three integers are checked for calendar validity through UTC so the process timezone
 * plays no part, and "not in the future" is a plain string comparison against the desk's today.
 *
 * WHY NOT `new Date()` FOR TODAY. Until 2026-09-10 this compared against the host's local day.
 * On Vercel that is UTC, five hours behind the desk, so from midnight to 05:00 on the desk's
 * clock a deal dated today — the date picker's default — was refused as being in the future.
 *
 * Throws an AppError, so callers must translate it (see `sendIfAppError`) — this runs before any
 * transaction is opened, so it is not inside handleMutation's own catch.
 */
export function parseTxnDate(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  const s = String(raw).trim()
  if (!s) return null

  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw appError(400, 'Enter the transaction date as YYYY-MM-DD.')
  }

  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  // Rebuilding the fields catches roll-over ('2026-02-30' becomes March 2nd) — a real calendar
  // date is one that survives the round trip unchanged.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw appError(400, `${s} is not a real calendar date.`)
  }

  if (s < MIN_TXN_DATE) {
    throw appError(400, `The transaction date cannot be before ${MIN_TXN_DATE}.`)
  }

  // ISO dates compare correctly as strings, so this is a calendar comparison on the desk's own
  // day with no Date object and no timezone involved.
  if (s > deskToday()) {
    throw appError(400, 'The transaction date cannot be in the future.')
  }

  return s
}
