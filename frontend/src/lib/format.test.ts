import { describe, it, expect } from 'vitest'
import { shortRef, txnAmountParts } from './format'

// The client's report: buy AED 1,000 from a customer, open their record, and the amount reads
// "PKR 77,000" — a currency that was never part of the deal. Every screen was reaching for the
// stored rupee value as its headline figure.
//
// This helper is where the "which figure leads" decision now lives, once. These tests pin that
// decision, because the failure mode is not an error — it is a plausible-looking number in the
// wrong currency, which reads as correct until someone reconciles it against a counterparty.
describe('txnAmountParts', () => {
  const buy = { type: 'purchase', currency: 'AED', amount: 1000, pkrValue: 77_000 }

  it('leads with the currency actually dealt, not the rupee conversion', () => {
    const { primary, secondary } = txnAmountParts(buy)
    expect(primary).toBe('1,000 AED')
    expect(primary).not.toMatch(/PKR/)
    expect(secondary).toBe('PKR 77,000')
  })

  it('offers the rupee equivalent secondarily rather than dropping it', () => {
    // The requirement allows a converted figure, as long as it never replaces the original.
    expect(txnAmountParts(buy).secondary).toBe('PKR 77,000')
  })

  it('does the same for a sale', () => {
    expect(txnAmountParts({ type: 'sale', currency: 'USD', amount: 500, pkrValue: 141_000 }).primary).toBe('500 USD')
  })

  it('keeps each currency distinct rather than collapsing them to one', () => {
    // The multi-currency case. Two transactions, two currencies, two different primary figures —
    // neither converted into the other, and neither into a shared base currency.
    const rows = [
      { type: 'purchase', currency: 'AED', amount: 1000, pkrValue: 77_000 },
      { type: 'purchase', currency: 'USD', amount: 500, pkrValue: 141_000 },
      { type: 'sale', currency: 'JPY', amount: 100_000, pkrValue: 190_000 },
    ]
    expect(rows.map((r) => txnAmountParts(r).primary)).toEqual(['1,000 AED', '500 USD', '100,000 JPY'])
  })

  it('treats a receipt or payment as genuinely rupees, with no pointless conversion line', () => {
    // Settlements move rupees and nothing else. Adding "≈ PKR x" restating the same number would
    // be noise, and implying a foreign currency was involved would be wrong.
    for (const type of ['receive', 'pay']) {
      const parts = txnAmountParts({ type, amount: 50_000, pkrValue: 50_000 })
      expect(parts.primary).toBe('PKR 50,000')
      expect(parts.secondary, `${type} should have no secondary line`).toBeNull()
    }
  })

  it('falls back to AED for a legacy row with no currency, rather than showing a bare number', () => {
    // Rows predating multi-currency carry no code. AED was the only currency then, so that is the
    // truthful reading — and it still names a currency rather than leaving the figure ambiguous.
    expect(txnAmountParts({ type: 'purchase', amount: 100, pkrValue: 7_700 }).primary).toBe('100 AED')
  })

  it('respects each currency\'s own quantity precision', () => {
    expect(txnAmountParts({ type: 'purchase', currency: 'IRR', amount: 1_000_000, pkrValue: 202 }).primary).toBe('1,000,000 IRR')
  })
})

// ---------------------------------------------------------------------------
// shortRef
// ---------------------------------------------------------------------------
// Reported 2026-09-09: "the ref, type and party are so close that even can't differentiate".
// The Transactions list printed a full 36-character uuid into a 64px column, which overran it and
// shoved the next two columns hard against it. The column widths were the symptom.
// ---------------------------------------------------------------------------

describe('shortRef', () => {
  it('cuts a uuid down to eight characters', () => {
    expect(shortRef('ef5e6ead-4596-430a-9f76-40601c60cc2e')).toBe('EF5E6EAD')
  })

  it('leaves a real journal reference alone rather than slicing it into nonsense', () => {
    // JV-1 is meaningful and already short. Truncating it would destroy the one ref in this table
    // that a person actually chose.
    expect(shortRef('JV-1')).toBe('JV-1')
    expect(shortRef('JV-1024')).toBe('JV-1024')
  })

  it('uppercases whatever it returns, so the column reads consistently', () => {
    expect(shortRef('jv-7')).toBe('JV-7')
  })
})
