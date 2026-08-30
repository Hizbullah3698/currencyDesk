import { currencyMeta, quoteRate } from './engine'

/** Credit/debit balances are always shown as positive numbers — sign is conveyed by a label, never a minus sign. */
export function fmt(n: number): string {
  return 'PKR ' + Math.round(n || 0).toLocaleString('en-US')
}

export function fmtNum(n: number, decimals = 0): string {
  return (n || 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/**
 * A rate ALREADY in a currency's own quote convention (what the dealer typed / what is stored on
 * an Activity row). Decimal places come from the currency registry rather than a hardcoded 2, so
 * a currency that needs more precision in its own convention gets it without a new constant here.
 * `code` is optional and defaults to a 'multiply'-quoted 2-decimal currency, so the many existing
 * one-argument call sites keep their exact previous output.
 */
export function fmtRate(n: number, code?: string): string {
  const d = currencyMeta(code).rateDecimals
  return (n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

/**
 * A CANONICAL PKR-per-unit figure (a stored weighted-average cost, a replayed running average)
 * rendered in `code`'s own quote convention. This is the display half of the boundary described
 * in the engine's currencies.ts — without it an IRR average cost prints as "0.000202" rather
 * than the "4,952.53 IRR per 1 PKR" a dealer actually reads.
 */
export function fmtQuote(code: string | undefined, pkrPerUnitValue: number): string {
  return fmtRate(quoteRate(code, pkrPerUnitValue), code)
}

/** A QUANTITY of a currency, at that currency's own quantity precision. */
export function fmtAmount(n: number, code?: string): string {
  return fmtNum(n, currencyMeta(code).amountDecimals)
}

export function fmtSigned(n: number): string {
  const s = fmt(Math.abs(n))
  return n < 0 ? '-' + s : s
}

export function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Cheque.due is a real 'YYYY-MM-DD' date from the server now (Phase 2), not a pre-formatted
 * display string — this is where that formatting now happens instead. Appending a local
 * midnight time avoids the classic bug where parsing a bare date string gets treated as UTC and
 * shifts a day in negative-offset timezones. A longer string is already a full timestamp (e.g.
 * whatever `activityDate()` returned for a row with no txnDate) and is parsed as-is. */
export function fmtShortDate(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Same parsing rule as fmtShortDate, but with the year — for a dealing slip or a printed
 * document, where "Aug 30" alone is not a complete record of when the deal was struck. */
export function fmtLongDate(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
