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
    expect(cols.date + cols.particulars + cols.voucher + cols.debit + cols.credit + cols.balance).toBeCloseTo(printable, 6)
  })

  it('shows exact paisa by default: whole rupees is a deliberate choice for the client, not the default', () => {
    expect(C.amountDecimals).toBe(2)
  })

  it('uses a placeholder business name, and no invented address or phone, until branding is real data', () => {
    expect(C.business.name).toBe('DESK NAME')
    expect(C.business.addressLines).toEqual([])
    expect(C.business.phone).toBe('')
  })

  it('states the account currency the data model keeps balances in', () => {
    expect(C.accountCurrency).toEqual({ code: 'PKR', name: 'Pakistani Rupee' })
  })

  it('sets transaction text at 10-11 pt with a second line no smaller than 8.5 pt, on A4 portrait', () => {
    expect(C.font.body).toBeGreaterThanOrEqual(10)
    expect(C.font.body).toBeLessThanOrEqual(11)
    expect(C.font.detail).toBeGreaterThanOrEqual(8.5)
    expect(C.font.date).toBeGreaterThanOrEqual(8.5)
    expect(C.minFigureSize).toBeGreaterThanOrEqual(6.5)
    expect([C.page.width, C.page.height]).toEqual([210, 297])
  })
})

describe('statement palette', () => {
  it('uses a restrained navy as its one accent, dark enough to read as text at any size', () => {
    expect(PALETTE.brand).toBe('#1e3a5f')
    expect(contrast(COLOR.brand, COLOR.white)).toBeGreaterThanOrEqual(7)
  })

  it('has every text colour readable on both plain white and the shaded rows', () => {
    for (const [name, c] of [['brand', COLOR.brand], ['ink', COLOR.ink], ['detail', COLOR.detail], ['light', COLOR.light]] as const) {
      expect(contrast(c, COLOR.white), `${name} on white`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c, COLOR.tint), `${name} on the tint`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('makes the label grey lighter than the detail grey, and both lighter than ink — a hierarchy, not one grey', () => {
    expect(grey(COLOR.ink)).toBeLessThan(grey(COLOR.detail))
    expect(grey(COLOR.detail)).toBeLessThan(grey(COLOR.light))
  })

  it('keeps hairlines visible in black and white without competing with the text', () => {
    expect(grey(COLOR.rule)).toBeLessThan(235)
    expect(grey(COLOR.rule)).toBeGreaterThan(grey(COLOR.light) + 60)
  })

  it('has a tint of about 6% of the brand over white', () => {
    const mixed = COLOR.brand.map((v) => Math.round(v * 0.06 + 255 * 0.94))
    expect(COLOR.tint).toEqual(mixed)
  })

  it('keeps the shading visible but faint in black and white: a few percent darker than paper, not more', () => {
    const drop = grey(COLOR.white) - grey(COLOR.tint) // grey levels out of 255
    expect(drop, `shading is ${drop}/255 darker than white in grayscale`).toBeGreaterThanOrEqual(6)
    expect(drop).toBeLessThanOrEqual(25)
  })

  it('uses no red and no green anywhere: every colour is neutral or blue-leaning', () => {
    // Colour is identity and hierarchy, never meaning — so a black-and-white copy loses nothing.
    for (const [name, [r, g, b]] of Object.entries(COLOR)) {
      expect(b, `${name} must not lean red`).toBeGreaterThanOrEqual(r)
      expect(b, `${name} must not lean green`).toBeGreaterThanOrEqual(g)
    }
  })
})
