import { toPaisa } from '@currencydesk/engine'
import type { AmountDecimals } from './statementConfig'

// ---------------------------------------------------------------------------
// Money on the statement — always whole paisa underneath
// ---------------------------------------------------------------------------
//
// Every figure the statement adds is an INTEGER number of paisa. Floats are converted once, on the way
// in, with the engine's `toPaisa` (which rounds on the decimal digits the way Postgres does); after that
// nothing is ever added in floating point, so a column that adds up in paisa adds up on paper and the
// identity  opening + debits - credits = closing  cannot be off by a binary artefact.
//
// Sign convention, matching the rest of the app: a positive NET is DEBIT (Dr) — the customer owes the
// desk — and a negative net is CREDIT (Cr) — the desk owes the customer. A balance never prints a minus
// sign; it prints its side.

/** A signed count of paisa: positive Dr, negative Cr. */
export type Paisa = number

/** Rupees (a float from the ledger) to whole paisa. */
export const rupeesToPaisa = (n: number): Paisa => toPaisa(n)

/** Whole rupees from paisa, rounded half away from zero, for the `0`-decimals setting. */
function wholeRupees(absPaisa: number): number {
  return Math.floor(absPaisa / 100) + (absPaisa % 100 >= 50 ? 1 : 0)
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** "1,234.56" (or "1,235" at 0 decimals). Absolute value — the caller decides the side. */
export function formatPaisa(paisa: Paisa, decimals: AmountDecimals): string {
  const abs = Math.abs(paisa)
  if (decimals === 0) return group(String(wholeRupees(abs)))
  const rupees = Math.floor(abs / 100)
  const cents = String(abs % 100).padStart(2, '0')
  return `${group(String(rupees))}.${cents}`
}

/** "1,234.56 Dr" / "1,234.56 Cr" — and a bare "0.00" for nothing, which has no side. */
export function formatBalance(net: Paisa, decimals: AmountDecimals): string {
  const text = formatPaisa(net, decimals)
  if (net === 0 || /^0(\.0+)?$/.test(text)) return text
  return `${text} ${net > 0 ? 'Dr' : 'Cr'}`
}

/** A quantity of a currency, with the thousands separators the desk reads: 3,000,000,000. */
export function formatUnits(units: number, decimals: number): string {
  const abs = Math.abs(units)
  const fixed = abs.toFixed(decimals)
  const [whole, frac] = fixed.split('.')
  return frac ? `${group(whole)}.${frac}` : group(whole)
}

/** A rate as a dealer writes it: 788, 80, 4952.53 — trailing zeros dropped, up to `maxDecimals` kept. */
export function formatRate(rate: number, maxDecimals: number): string {
  const fixed = rate.toFixed(maxDecimals)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  const [whole, frac] = trimmed.split('.')
  return frac ? `${group(whole)}.${frac}` : group(whole)
}
