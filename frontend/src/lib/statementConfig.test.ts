import { describe, it, expect } from 'vitest'
import { COLOR, PALETTE, STATEMENT_CONFIG as C, type RGB } from './statementConfig'

// WCAG relative luminance and contrast ratio, computed here rather than trusted from a comment.
const lin = (v: number) => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const grey = ([r, g, b]: RGB) => Math.round(0.299 * r + 0.587 * g + 0.114 * b)

describe('statement config', () => {
  it('keeps at least three entries with the closing balance', () => {
    expect(C.keepWithClosing).toBeGreaterThanOrEqual(3)
  })

  it('has column widths that add up to the printable width', () => {
    const printable = C.page.width - C.margin.left - C.margin.right
    const cols = C.columns
    expect(cols.date + cols.particulars + cols.debit + cols.credit + cols.balance).toBeCloseTo(printable, 6)
  })

  it('keeps a clear gap between the description text and the Debit column', () => {
    expect(C.particularsGap).toBeGreaterThanOrEqual(2)
  })

  it('shows exact paisa by default: whole rupees is a deliberate choice for the client, not the default', () => {
    expect(C.amountDecimals).toBe(2)
  })

  it('names the business "Currency Desk" — two words, never run together — and invents no address or phone', () => {
    expect(C.business.name).toBe('Currency Desk')
    expect(C.business.tagline).toBe('')
    expect(C.business.addressLines).toEqual([])
    expect(C.business.phone).toBe('')
  })

  it('states the account currency the data model keeps balances in', () => {
    expect(C.accountCurrency).toEqual({ code: 'PKR', name: 'Pakistani Rupee' })
  })

  it('sets type in the ranges a printed statement needs, on A4 portrait with 12-15 mm margins', () => {
    expect(C.font.body).toBeGreaterThanOrEqual(10)
    expect(C.font.body).toBeLessThanOrEqual(11)
    expect(C.font.secondary).toBeGreaterThanOrEqual(9)
    expect(C.font.balance).toBeGreaterThanOrEqual(20)
    expect(C.font.balance).toBeLessThanOrEqual(26)
    expect(C.font.business).toBeGreaterThanOrEqual(16)
    expect(C.font.business).toBeLessThanOrEqual(22)
    expect(C.font.footer).toBeGreaterThanOrEqual(8)
    expect(C.minFigureSize).toBeGreaterThanOrEqual(6.5)
    expect([C.page.width, C.page.height]).toEqual([210, 297])
    expect(C.margin.left).toBeGreaterThanOrEqual(12)
    expect(C.margin.left).toBeLessThanOrEqual(15)
  })
})

describe('statement palette', () => {
  it("uses the approved design's deep teal as its one accent, readable as text on white", () => {
    expect(PALETTE.brand).toBe('#183e46')
    expect(contrast(COLOR.brand, COLOR.white)).toBeGreaterThanOrEqual(7)
  })

  it('keeps every word on the teal balance panel readable, the quieter text included', () => {
    expect(contrast(COLOR.onBrand, COLOR.brand)).toBeGreaterThanOrEqual(7)
    expect(contrast(COLOR.onBrandMuted, COLOR.brand)).toBeGreaterThanOrEqual(4.5)
  })

  it('shades alternate rows more faintly than table heads, and both stay visible in black and white', () => {
    expect(grey(COLOR.zebra)).toBeGreaterThan(grey(COLOR.tint))
    expect(grey(COLOR.white) - grey(COLOR.zebra)).toBeGreaterThanOrEqual(3)
    for (const [name, c] of [['ink', COLOR.ink], ['detail', COLOR.detail], ['light', COLOR.light], ['brand', COLOR.brand]] as const) {
      expect(contrast(c, COLOR.zebra), `${name} on alternate rows`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('has every text colour readable on both plain white and the shaded rows', () => {
    for (const [name, c] of [['brand', COLOR.brand], ['ink', COLOR.ink], ['detail', COLOR.detail], ['light', COLOR.light]] as const) {
      expect(contrast(c, COLOR.white), `${name} on white`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c, COLOR.tint), `${name} on the tint`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps both greys well clear of ink — a hierarchy, not one grey', () => {
    expect(grey(COLOR.ink)).toBeLessThan(grey(COLOR.detail) - 40)
    expect(grey(COLOR.ink)).toBeLessThan(grey(COLOR.light) - 40)
  })

  it('keeps hairlines visible in black and white without competing with the text', () => {
    expect(grey(COLOR.rule)).toBeLessThan(235)
    expect(grey(COLOR.rule)).toBeGreaterThan(grey(COLOR.light) + 60)
  })

  it('keeps the table-heading wash nearly neutral: at most a faint cool cast', () => {
    const [r, g, b] = COLOR.tint
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(8)
  })

  it('keeps the shading visible but faint in black and white: a few percent darker than paper, not more', () => {
    const drop = grey(COLOR.white) - grey(COLOR.tint) // grey levels out of 255
    expect(drop, `shading is ${drop}/255 darker than white in grayscale`).toBeGreaterThanOrEqual(6)
    expect(drop).toBeLessThanOrEqual(25)
  })

  it('uses no red and no green anywhere: every colour is neutral or blue/teal-leaning', () => {
    // Colour is identity and hierarchy, never meaning — so a black-and-white copy loses nothing.
    for (const [name, [r, g, b]] of Object.entries(COLOR)) {
      expect(b, `${name} must not lean red`).toBeGreaterThanOrEqual(r)
      expect(b, `${name} must not lean green`).toBeGreaterThanOrEqual(g)
    }
  })
})
