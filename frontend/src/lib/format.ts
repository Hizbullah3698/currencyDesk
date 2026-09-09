import { currencyMeta, quoteRate } from './engine'

/** Credit/debit balances are always shown as positive numbers — sign is conveyed by a label, never a minus sign. */
export function fmt(n: number): string {
  return 'PKR ' + Math.round(n || 0).toLocaleString('en-US')
}

export function fmtNum(n: number, decimals = 0): string {
  return (n || 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/**
 * A quantity shortened to fit a chart axis tick — "12.5k", "3.4M". For axis labels and nothing
 * else: it rounds hard, so never use it where a figure is read as a number (a ledger cell, a
 * balance, anything that has to reconcile). An IRR position runs to nine figures, and a Y axis
 * printing "495,253,000" against every gridline is unreadable at 10px.
 */
export function fmtCompact(n: number): string {
  const v = n || 0
  const abs = Math.abs(v)
  const unit = (div: number, suffix: string) => {
    const scaled = v / div
    // One decimal below 10 of the unit (1.2M), none above it (12M) — enough to separate adjacent
    // gridlines without printing digits the tick is too small to read.
    return `${scaled.toFixed(Math.abs(scaled) < 10 ? 1 : 0).replace(/\.0$/, '')}${suffix}`
  }
  if (abs >= 1e9) return unit(1e9, 'B')
  if (abs >= 1e6) return unit(1e6, 'M')
  // Thresholds are exactly the unit boundaries, with no dead band: at 1e4 the axis printed "14k"
  // against "9,000" and "4,500", three formats on one scale.
  if (abs >= 1e3) return unit(1e3, 'k')
  return fmtNum(v, abs > 0 && abs < 10 ? 2 : 0)
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

// ---------------------------------------------------------------------------
// What a transaction's headline amount should be
// ---------------------------------------------------------------------------
//
// THE BUG THIS EXISTS TO PREVENT: buy 1,000 AED from a customer, open that customer's record, and
// the amount reads "PKR 77,000" — a currency that was never part of the deal. Every screen showing
// a transaction was reaching for `pkrValue` as its headline figure and leaving the real currency in
// small muted text beside it, or nowhere.
//
// Note what the cause was NOT. `fmt()` hardcoding "PKR " is correct — it formats rupee amounts, and
// balances, receivables and settlement totals genuinely ARE rupees. Rewriting it would have
// corrupted every figure that was right. The fault was upstream of formatting: the display layer
// picked the converted number as primary.
//
// So the decision of WHICH figure leads lives here, once, instead of being re-made on each screen.
// Screens choose their own layout for the two parts; they do not get to choose which is which.

export interface TxnAmountParts {
  /** The figure to show large. What was actually transacted. */
  primary: string
  /** Rupee equivalent, for a foreign-currency deal. Null when the transaction WAS in rupees, so a
   *  settlement is not decorated with a pointless "≈" restating its own amount. */
  secondary: string | null
}

/**
 * Splits a transaction into the amount that was actually dealt and its rupee equivalent.
 *
 * A trade leads with its own currency — "1,000 AED" — because that is what happened; the rupee
 * value is a conversion and is offered second. A receipt or payment moves rupees and nothing else,
 * so rupees ARE the real amount and there is no equivalent to add.
 */
export function txnAmountParts(t: { type: string; currency?: string; amount?: number; pkrValue?: number }): TxnAmountParts {
  const isTrade = t.type === 'purchase' || t.type === 'sale'
  if (!isTrade) return { primary: fmt(t.pkrValue ?? t.amount ?? 0), secondary: null }
  const code = t.currency || 'AED'
  return {
    primary: `${fmtAmount(t.amount || 0, code)} ${code}`,
    secondary: fmt(t.pkrValue || 0),
  }
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

/**
 * A reference short enough to read at a glance.
 *
 * Activity and cheque rows have no human reference of their own, so the row id stood in — and
 * that is a 36-character uuid. Printed in full it overran a 64px column and shunted Type and
 * Party hard against it, which is the collision in the 2026-09-09 report; the columns were the
 * symptom, the id was the cause. Eight hex characters is what every git short-hash and every
 * other ledger uses for the same job, and the full value stays on the row's `title` for anyone
 * who needs to quote it.
 *
 * Journal entries DO have a real reference (`JV-1`), which is already short and already meaningful
 * — those pass through untouched rather than being sliced into nonsense.
 */
export function shortRef(id: string): string {
  const s = id.toUpperCase()
  return s.length > 12 ? s.slice(0, 8) : s
}
