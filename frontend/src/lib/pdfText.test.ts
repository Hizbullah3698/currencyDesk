import { describe, it, expect } from 'vitest'
import { assertPdfSafeLiteral, isPdfSafeChar, pdfText, type TextWarning } from './pdfText'

describe('pdfText — only text the standard PDF font can print', () => {
  it('passes plain Latin text, the middle dot and the em dash untouched, with no warning', () => {
    const w: TextWarning[] = []
    expect(pdfText('Sale · 500 AED @ 80 — Meezan', 'Description', w)).toBe('Sale · 500 AED @ 80 — Meezan')
    expect(pdfText('Café Müller €', 'Customer name', w)).toBe('Café Müller €')
    expect(w).toEqual([])
  })

  it('replaces an unsupported character with ? AND reports which field and which character', () => {
    const w: TextWarning[] = []
    const out = pdfText('Ali → Bilal', 'Entry narration JV-016', w)
    expect(out).toBe('Ali ? Bilal')
    expect(w).toHaveLength(1)
    expect(w[0].field).toBe('Entry narration JV-016')
    expect(w[0].characters).toEqual(['→'])
    expect(w[0].printedAs).toBe('Ali ? Bilal')
  })

  it('never silently prints Arabic or Urdu: every letter is reported', () => {
    const w: TextWarning[] = []
    const out = pdfText('محمد علي', 'Customer name', w)
    expect(out).toBe('???? ???')
    expect(w[0].field).toBe('Customer name')
    expect(w[0].characters.length).toBeGreaterThan(0)
  })

  it('treats a character outside the BMP as one replacement, not two', () => {
    const w: TextWarning[] = []
    expect(pdfText('Deal 😀 done', 'Narration', w)).toBe('Deal ? done')
    expect(w[0].characters).toEqual(['😀'])
  })

  it('tidies whitespace and newlines without calling it a loss', () => {
    const w: TextWarning[] = []
    expect(pdfText('  a   b\n\tc  ', 'Narration', w)).toBe('a b c')
    expect(pdfText(null, 'Narration', w)).toBe('')
    expect(w).toEqual([])
  })

  it('reports a field once, however often it is asked for', () => {
    const w: TextWarning[] = []
    pdfText('→', 'Customer name', w)
    pdfText('→ ←', 'Customer name', w)
    expect(w).toHaveLength(1)
    expect(w[0].characters).toEqual(['→', '←'])
  })

  it('knows the boundary of what the font prints', () => {
    expect(isPdfSafeChar('A')).toBe(true)
    expect(isPdfSafeChar('·')).toBe(true)
    expect(isPdfSafeChar('€')).toBe(true)
    expect(isPdfSafeChar('→')).toBe(false)
    expect(isPdfSafeChar('م')).toBe(false)
    expect(isPdfSafeChar('\n')).toBe(false)
  })

  it('refuses wording OF OUR OWN that the font cannot print — "to", not an arrow', () => {
    expect(assertPdfSafeLiteral('Transfer to')).toBe('Transfer to')
    expect(() => assertPdfSafeLiteral('Transfer →')).toThrow(/cannot print/)
  })
})
