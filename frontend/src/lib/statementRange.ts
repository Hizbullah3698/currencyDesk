import { rangeBounds, type LedgerRange } from './engine'

/**
 * The bounds a customer statement is cut on, from the two 'YYYY-MM-DD' strings the date pickers hold.
 *
 * Extracted from pages/LedgerDetail.tsx so it can be tested — that page is a component, and this
 * frontend's tests run with no DOM. Blank on either side means unbounded on that side.
 *
 * WHY THIS GOES THROUGH rangeBounds() AND NOT stampTime(). Until 2026-09-10 the page did
 * `toT: stampTime(to)`, and stampTime parses a bare 'YYYY-MM-DD' as UTC MIDNIGHT — 05:00 on the
 * desk's clock. A deal struck on that same day is pinned by activityDate() to LOCAL NOON, which is
 * after 05:00, so every deal dated on the "To" day fell just outside the range and was silently
 * dropped from the statement, the PDF and the Excel export, with a closing balance short by exactly
 * those deals. Real statements went out to real customers this way.
 *
 * rangeBounds() is what the balance sheet and income statement already use: it starts a day at
 * 00:00:00.000 and ends it at 23:59:59.999, both LOCAL, so "1–30 September" means the whole of the
 * 30th. Reusing it rather than writing a third copy of end-of-day is the point — the two reports
 * never had this bug precisely because they did not build their own bounds.
 */
export function statementRange(from: string, to: string): LedgerRange {
  const b = rangeBounds('custom', from, to)
  return {
    fromT: b.hasFrom ? b.fromT : undefined,
    toT: b.hasTo ? b.toT : undefined,
  }
}
