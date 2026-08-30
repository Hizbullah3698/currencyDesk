import { appError } from '../services/transact.js'

// The earliest date the desk will accept as a deal date. Not a business rule the client asked
// for so much as a typo guard: '0202-08-14' parses fine as a real calendar date and would
// silently land 1,800 years in the past on every report that cuts on txn_date.
const MIN_TXN_DATE = '2000-01-01'

/**
 * Validates the optional `txnDate` on a trade/settlement request body and returns it as a plain
 * 'YYYY-MM-DD' string, or `null` when it is absent/blank (the server then defaults the column to
 * CURRENT_DATE — see migration 012).
 *
 * Deliberately strict about the FORMAT rather than handing the string to `new Date()`: Date's
 * parser accepts far more than the contract allows ('2026-8-4', 'Aug 4 2026', '2026-08-04T…')
 * and resolves a bare 'YYYY-MM-DD' as UTC, which in a negative-offset zone is the previous local
 * day. Parsing the three integers out and rebuilding a LOCAL date keeps "not in the future"
 * measured against the server's own calendar day, the same one CURRENT_DATE would have used.
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
  const dt = new Date(y, m - 1, d)
  // Rebuilding the fields catches roll-over ('2026-02-30' becomes March 2nd) — a real calendar
  // date is one that survives the round trip unchanged.
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    throw appError(400, `${s} is not a real calendar date.`)
  }

  if (s < MIN_TXN_DATE) {
    throw appError(400, `The transaction date cannot be before ${MIN_TXN_DATE}.`)
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (dt.getTime() > today.getTime()) {
    throw appError(400, 'The transaction date cannot be in the future.')
  }

  return s
}
