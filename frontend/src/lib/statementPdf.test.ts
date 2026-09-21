import { describe, it, expect } from 'vitest'
import type { Account, Activity } from './engine'
import { buildStatementDocument } from './statementDoc'
import { renderStatementPdf, statementPdfBytes } from './statementPdf'

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
    // One "Description" table header per page.
    expect(text.split('(Description)').length - 1).toBe(pages)
    // A continuation header on every page after the first (its own text, not the "(continued)" date bands).
    expect(text.split('  |  continued').length - 1).toBe(pages - 1)
    // And a day that carries on over a page break says so on the new page.
    // (jsPDF escapes parentheses inside a string, so the closing one is written \) in the stream.)
    expect(text).toContain(String.raw`continued\)`)
  })

  it('never leaves the closing balance alone on a page, for any length', () => {
    for (const n of [30, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 60, 87, 88, 89, 90, 91]) {
      const doc = renderStatementPdf(build(n), { compress: false })
      const pages = doc.getNumberOfPages()
      const text = textOf(doc.output('arraybuffer') as ArrayBuffer)
      // Split into per-page chunks on the page-number footers and check the page holding "Closing balance"
      // also holds sale rows.
      const chunks = text.split(/\(Page \d+ of \d+\)/)
      const holder = chunks.findIndex((c: string) => c.includes('(Closing balance)'))
      expect(holder, `n=${n}`).toBeGreaterThanOrEqual(0)
      const rows = (chunks[holder].match(/\(Sale /g) || []).length
      expect(rows, `n=${n}: closing on page ${holder + 1} of ${pages} with ${rows} rows`).toBeGreaterThanOrEqual(3)
    }
  })

  it('reads the same figures the document model carries', () => {
    const d = build(5)
    const text = textOf(statementPdfBytes(d, { compress: false }))
    expect(text).toContain('(Closing balance)')
    // Total debits and closing appear with their side.
    const closing = (Math.abs(d.closing) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' Dr'
    expect(text).toContain(`(${closing})`)
  })
})
