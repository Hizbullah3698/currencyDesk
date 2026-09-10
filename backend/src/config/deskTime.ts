import { env } from './env.js'

// ---------------------------------------------------------------------------
// The desk's calendar day, computed on the server
// ---------------------------------------------------------------------------
//
// THE FAULT THIS CLOSES. The desk is in Pakistan (UTC+5). The server is wherever Vercel runs it,
// on UTC, and Neon's session timezone is UTC too. Until 2026-09-10 every place the server needed
// "today" asked one of those two clocks: parseTxnDate compared against `new Date()` (so between
// 00:00 and 05:00 on the desk's clock a deal dated today was refused as being in the future),
// trades and settlements without a txnDate defaulted to the database's CURRENT_DATE, manual journal
// entries always did, and a cheque's clearing voucher took `updated_at::date` — all of them
// yesterday for the first five hours of every desk day.
//
// WHY NOT `TZ=Asia/Karachi` ON VERCEL, OR `SET TIME ZONE` ON THE CONNECTION. Both would work and
// both are settings that live outside the repository: an env var nobody would notice missing on a
// fresh project, and a session setting that Neon's connection pooler (pgbouncer in transaction
// mode) does not reliably keep between statements. This module instead makes the desk's zone an
// explicit input to every date the server derives, so the code is correct on any host, in any
// process timezone, against any pooler — and a test can prove it by pinning the process to UTC.
//
// THE RULE: no server-side code may derive a calendar date from `new Date()` or from the
// database's `CURRENT_DATE`/`now()::date` directly. It goes through here.

/**
 * 'YYYY-MM-DD' for `instant` on the desk's calendar.
 *
 * `Intl.DateTimeFormat` with an explicit `timeZone` is the only timezone-aware date arithmetic
 * Node has without a library, and the `en-CA` locale is the one whose default numeric format is
 * already ISO order. `formatToParts` is used rather than trusting the locale's separators.
 */
export function deskDate(instant: Date = new Date(), timeZone: string = env.deskTimeZone): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Today, on the desk's calendar. */
export function deskToday(): string {
  return deskDate()
}

/**
 * `n` days after a 'YYYY-MM-DD', as 'YYYY-MM-DD'. Built from the parts through UTC so the process
 * timezone cannot leak in — the same technique openingStockService's dayBefore already uses.
 */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

/** "Sep 9" for `instant` on the desk's calendar — the cheque history line format. */
export function deskShortDate(instant: Date = new Date(), timeZone: string = env.deskTimeZone): string {
  return instant.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })
}
