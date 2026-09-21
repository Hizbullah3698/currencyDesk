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
    expect(cols.description + cols.ref + cols.debit + cols.credit + cols.balance).toBeCloseTo(printable, 6)
  })

  it('shows exact paisa by default: whole rupees is a deliberate choice for the client, not the default', () => {
    expect(C.amountDecimals).toBe(2)
  })

  it('uses a placeholder desk name until branding is real data', () => {
    expect(C.deskName).toBe('DESK NAME')
  })

  it('sets a table row on a 16 pt pitch and its text between 8.5 and 9 pt', () => {
    expect(C.row.entry / 0.3528, 'row pitch in pt').toBeGreaterThan(15.7)
    expect(C.row.entry / 0.3528).toBeLessThan(16.3)
    expect(C.font.body).toBeGreaterThanOrEqual(8.5)
    expect(C.font.body).toBeLessThanOrEqual(9)
  })

  it('has a top band about 20 mm tall, with room reserved for a logo that does not exist yet', () => {
    expect(C.band.height).toBe(20)
    expect(C.band.logoWidth).toBe(0)
  })
})

describe('statement palette', () => {
  it('is the app\'s own brand colour', () => {
    // --color-accent-solid in index.css, which the in-app logo is filled with.
    expect(PALETTE.brand).toBe('#2563eb')
  })

  it('has white text on the brand band at 4.5:1 or better (WCAG AA)', () => {
    expect(contrast(COLOR.white, COLOR.brand)).toBeGreaterThanOrEqual(4.5)
  })

  it('has every text colour readable on both plain white and the tinted stripe', () => {
    for (const [name, c] of [['brand', COLOR.brand], ['ink', COLOR.ink], ['detail', COLOR.detail], ['light', COLOR.light]] as const) {
      expect(contrast(c, COLOR.white), `${name} on white`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c, COLOR.tint), `${name} on the tint`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('makes the lighter grey lighter than the detail grey, and both lighter than ink — a hierarchy, not one grey', () => {
    expect(grey(COLOR.ink)).toBeLessThan(grey(COLOR.detail))
    expect(grey(COLOR.detail)).toBeLessThan(grey(COLOR.light))
  })

  it('has a tint of about 6% of the brand over white', () => {
    const mixed = COLOR.brand.map((v) => Math.round(v * 0.06 + 255 * 0.94))
    expect(COLOR.tint).toEqual(mixed)
  })

  it('keeps the stripe visible but faint in black and white: a few percent darker than paper, not more', () => {
    const drop = grey(COLOR.white) - grey(COLOR.tint) // grey levels out of 255
    expect(drop, `stripe is ${drop}/255 darker than white in grayscale`).toBeGreaterThanOrEqual(6)
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
