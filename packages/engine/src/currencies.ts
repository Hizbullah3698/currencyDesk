// ---------------------------------------------------------------------------
// Traded currencies and how each one is quoted against PKR
// ---------------------------------------------------------------------------
//
// The desk trades several foreign currencies against PKR, and they are not all quoted the same
// way — because they are not all worth the same *order of magnitude* as a rupee:
//
//   • AED is worth far MORE than a rupee (1 AED ≈ 77 PKR). A dealer naturally quotes it as
//     "PKR per 1 AED" and MULTIPLIES: 100 AED × 77 = 7,700 PKR.
//   • IRR is worth far LESS than a rupee (1 PKR ≈ 4,952 IRR). Quoting it as "PKR per 1 IRR"
//     would mean typing 0.000202 into a rate box, which no dealer does. It is quoted the other
//     way round — "IRR per 1 PKR" — and DIVIDED: 1,000,000 IRR ÷ 4,952.53 = 201.92 PKR.
//
// So `quote` is not a formatting preference, it is what the number in the rate box MEANS:
//   'multiply' → rate is PKR per 1 unit of the foreign currency  (pkr = amount × rate)
//   'divide'   → rate is foreign units per 1 PKR                 (pkr = amount ÷ rate)
//
// Everything downstream of the rate box works in ONE canonical unit — `pkrPerUnit`, the PKR
// value of a single unit of the currency — so the weighted-average-cost math, margin math and
// balance-sheet valuation never have to know which convention the rate was typed in. Only
// `pkrPerUnit()` (entry) and `quoteRate()` (display) sit on that boundary.

export type QuoteMode = 'multiply' | 'divide'

export interface CurrencyMeta {
  code: string
  /** Full name, for the currency picker and printed documents. */
  name: string
  quote: QuoteMode
  /** Label for the rate input, spelling out the convention rather than assuming the user knows it. */
  rateLabel: string
  /** Decimal places to show for a QUANTITY of this currency. */
  amountDecimals: number
  /** Decimal places to show for a RATE in this currency's own quote convention. */
  rateDecimals: number
}

// Ordered strongest-to-weakest against PKR, which is also the order the picker shows.
export const CURRENCY_LIST: CurrencyMeta[] = [
  {
    code: 'AED',
    name: 'UAE Dirham',
    quote: 'multiply',
    rateLabel: 'PKR per 1 AED',
    amountDecimals: 0,
    rateDecimals: 2,
  },
  {
    code: 'AFN',
    name: 'Afghan Afghani',
    quote: 'multiply',
    rateLabel: 'PKR per 1 AFN',
    amountDecimals: 0,
    rateDecimals: 2,
  },
  {
    code: 'IRR',
    name: 'Iranian Rial',
    quote: 'divide',
    rateLabel: 'IRR per 1 PKR',
    amountDecimals: 0,
    rateDecimals: 2,
  },
]

export const CURRENCY_META: Record<string, CurrencyMeta> = Object.fromEntries(CURRENCY_LIST.map((c) => [c.code, c]))

// An unknown code (an old row, or a Currency Stock account someone typed a new code into) is
// treated as a normal 'PKR per 1 unit' currency rather than throwing — that is how every code
// behaved before this registry existed, so old data keeps reading exactly as it always did.
const FALLBACK: CurrencyMeta = { code: '', name: '', quote: 'multiply', rateLabel: 'PKR per 1 unit', amountDecimals: 0, rateDecimals: 2 }

export function currencyMeta(code?: string): CurrencyMeta {
  const c = (code || 'AED').toUpperCase()
  return CURRENCY_META[c] || { ...FALLBACK, code: c, name: c, rateLabel: `PKR per 1 ${c}` }
}

export function currencyName(code?: string): string {
  const m = currencyMeta(code)
  return m.name || m.code
}

/**
 * The PKR value of ONE unit of `code`, given a rate typed in that currency's own quote
 * convention. This is the single conversion point between "what the dealer typed" and the
 * canonical number every other calculation in the app uses.
 */
export function pkrPerUnit(code: string | undefined, rate: number): number {
  if (!rate) return 0
  return currencyMeta(code).quote === 'divide' ? 1 / rate : rate
}

/**
 * Inverse of `pkrPerUnit` — turns a canonical PKR-per-unit figure (e.g. a stored weighted-average
 * cost) back into the currency's own quote convention for display, so a dealer reads an IRR cost
 * as "4,948.10 IRR per PKR" rather than "0.000202".
 */
export function quoteRate(code: string | undefined, pkrPerUnitValue: number): number {
  if (!pkrPerUnitValue) return 0
  return currencyMeta(code).quote === 'divide' ? 1 / pkrPerUnitValue : pkrPerUnitValue
}

/** Total PKR for `amount` units at a rate typed in `code`'s own quote convention. */
export function pkrValueOf(code: string | undefined, amount: number, rate: number): number {
  return amount * pkrPerUnit(code, rate)
}
