import { describe, it, expect } from 'vitest'
import type { Account, Activity } from './engine'
import { buildStatementDocument } from './statementDoc'
import { renderStatementPdf, statementPdfBytes } from './statementPdf'
import { COLOR } from './statementConfig'

// Renders in plain Node: jsPDF needs no DOM. Uncompressed, so the text of each page can be read straight
// out of the bytes — every string jsPDF draws appears in a content stream as `(text) Tj`.
const AUDIT = { createdBy: 'admin', updatedBy: 'admin' }
const CUST = '5c9ab663-ea1e-4196-85db-a1c4503bd44e'
const customer = { id: CUST, type: 'Customer', name: 'Dubai Tmn Buyer', notes: '', since: '', createdAt: '', updatedAt: '', ...AUDIT } as Account

function sale(i: number, day: number): Activity {
  return {
    id: `${(0xb0000000 + i).toString(16)}-0000-4000-8000-000000000000`,
    type: 'sale',
    currency: 'AED',
    customerId: CUST,
    customerName: customer.name,
    amount: 100 + i,
    rate: 80,
    pkrValue: (100 + i) * 80,
    method: 'Credit',
    txnDate: `2026-09-${String(10 + day).padStart(2, '0')}`,
    createdAt: `2026-09-${String(10 + day).padStart(2, '0')}T${String(6 + (i % 12)).padStart(2, '0')}:00:00.000Z`,
    updatedAt: '2026-09-15T00:00:00.000Z',
    ...AUDIT,
  } as Activity
}

const textOf = (bytes: ArrayBuffer) => new TextDecoder('latin1').decode(new Uint8Array(bytes))
const build = (n: number, days = 5) =>
  buildStatementDocument({ customer, accounts: [customer], activity: Array.from({ length: n }, (_, i) => sale(i, i % days)), cheques: [], journalEntries: [] }, { now: new Date(2026, 8, 21, 14, 5) })

describe('statement PDF — rendered', () => {
  it('produces a real one-page A4 PDF for a short statement', () => {
    const doc = renderStatementPdf(build(5), { compress: false })
    expect(doc.getNumberOfPages()).toBe(1)
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0)
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(297, 0)
    const bytes = statementPdfBytes(build(5), { compress: false })
    expect(textOf(bytes).slice(0, 5)).toBe('%PDF-')
    const text = textOf(bytes)
    expect(text).toContain('(Statement of Account)')
    expect(text).toContain('(Page 1 of 1)')
    expect(text).toContain('(Dubai Tmn Buyer)')
  })

  it('prints no address, URL or browser furniture', () => {
    const text = textOf(statementPdfBytes(build(60), { compress: false }))
    for (const bad of ['localhost', 'http://', 'https://', 'about:blank', 'www.']) expect(text.includes(bad), bad).toBe(false)
  })

  it('numbers every page "Page X of Y" and repeats the table header on each', () => {
    const bytes = statementPdfBytes(build(120), { compress: false })
    const text = textOf(bytes)
    const pages = renderStatementPdf(build(120), { compress: false }).getNumberOfPages()
    expect(pages).toBeGreaterThan(2)
    for (let p = 1; p <= pages; p++) expect(text, `page ${p}`).toContain(`(Page ${p} of ${pages})`)
    // One table header per page — small uppercase labels now.
    expect(text.split('(DESCRIPTION)').length - 1).toBe(pages)
    // A continuation header on every page after the first (its own text, not the "(continued)" date bands).
    expect(text.split('(continued) Tj').length - 1).toBe(pages - 1)
    // And a day that carries on over a page break says so on the new page.
    // (jsPDF escapes parentheses inside a string, so the closing one is written \) in the stream.)
    expect(text).toContain(String.raw`continued\)`)
  })

  it('never leaves the closing balance alone on a page, for any length', () => {
    // Around the page-1 boundary and the page-2 boundary at this pitch (page 1 holds ~28-34 entries, a later one ~44).
    for (const n of [24, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 70, 72, 74, 76, 77, 78, 79, 80, 82]) {
      const doc = renderStatementPdf(build(n), { compress: false })
      const pages = doc.getNumberOfPages()
      const text = textOf(doc.output('arraybuffer') as ArrayBuffer)
      // Split into per-page chunks on the page-number footers and check the page holding "Closing balance"
      // also holds sale rows.
      const chunks = text.split(/\(Page \d+ of \d+\)/)
      const holder = chunks.findIndex((c: string) => c.includes('(Closing balance)'))
      expect(holder, `n=${n}`).toBeGreaterThanOrEqual(0)
      // A row's type is its own bold run now, so a deal row is a `(Sale)` text.
      const rows = (chunks[holder].match(/\(Sale\)/g) || []).length
      expect(rows, `n=${n}: closing on page ${holder + 1} of ${pages} with ${rows} rows`).toBeGreaterThanOrEqual(3)
    }
  })

  it('reads the same figures the document model carries', () => {
    const d = build(5)
    const text = textOf(statementPdfBytes(d, { compress: false }))
    expect(text).toContain('(Closing balance)')
    // The closing figure's digits are one text run and its Dr/Cr another (smaller, lighter), so search the digits.
    const digits = (Math.abs(d.closing) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })
    expect(text).toContain(`(${digits})`)
    expect(text).toContain('(Dr)')
  })
})

describe('statement PDF — the look', () => {
  const stream = (n: number, o: { grayscale?: boolean } = {}) => textOf(statementPdfBytes(build(n), { compress: false, ...o }))
  /** Every colour the page sets, as [r, g, b] in 0-1: jsPDF writes `r g b rg` (fill and text) and `r g b RG` (stroke). */
  const colours = (text: string) => [...text.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (?:rg|RG)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])])

  it('has the brand band on page 1: desk name and title on it', () => {
    const text = stream(5)
    expect(text).toContain('(DESK NAME)')
    expect(text).toContain('(Statement of Account)')
    // The brand colour is set for the band's fill — 37/255, 99/255, 235/255.
    const [r, g, b] = COLOR.brand.map((v) => v / 255)
    expect(colours(text).some(([x, y, z]) => Math.abs(x - r) < 0.003 && Math.abs(y - g) < 0.003 && Math.abs(z - b) < 0.003)).toBe(true)
  })

  it('drops the formula sentence and labels the two totals plainly', () => {
    const text = stream(5)
    expect(text).not.toContain('Opening balance + Total debits')
    expect(text).toContain('(TOTAL DEBITS)')
    expect(text).toContain('(TOTAL CREDITS)')
  })

  it('carries no red or green anywhere on the page', () => {
    for (const [r, g, b] of colours(stream(60))) {
      expect(b, 'no colour leans red').toBeGreaterThanOrEqual(r - 0.002)
      expect(b, 'no colour leans green').toBeGreaterThanOrEqual(g - 0.002)
    }
  })

  it('renders in pure greys when asked, for a black-and-white proof', () => {
    // jsPDF writes an all-equal colour as a single-value grey operator (`0.4 g` / `0.4 G`) and only a genuine
    // colour as three components (`r g b rg`). So a grayscale render must have many grey operators and no
    // three-component colour at all — and the normal render must have the brand colour as one.
    const gray = stream(60, { grayscale: true })
    const greyOps = [...gray.matchAll(/(?:^|\s)([\d.]+) (?:g|G)(?=\s)/g)].length
    expect(greyOps, 'grey colour operators in the grayscale render').toBeGreaterThan(20)
    expect(colours(gray), 'coloured operators in the grayscale render').toEqual([])

    const colour = colours(stream(60))
    expect(colour.some(([r, , b]) => Math.abs(r - b) > 0.5), 'the normal render has the brand colour').toBe(true)
  })

  it('draws the plain facts on one grey line under the customer name', () => {
    const text = stream(5)
    expect(text).toMatch(/\(Account [0-9A-F]+ \u00b7 [^)]* to [^)]* \u00b7 Generated [^)]*\)/)
  })

  it('draws the type and its details as separate runs, so one can be bold and the other grey', () => {
    const text = stream(5)
    expect(text).toContain('(Sale)')
    expect(text).toMatch(/\( \u00b7 \d+ AED @ 80\)/)
  })

  it('has no boxed borders: rectangles are only ever filled', () => {
    expect(stream(60)).not.toMatch(/re\s+S\b/)
  })
})
