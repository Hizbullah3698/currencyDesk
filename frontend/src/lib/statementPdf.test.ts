import { describe, it, expect } from 'vitest'
import { jsPDF } from 'jspdf'
import type { Account, Activity, Cheque, JournalEntry } from './engine'
import { buildStatementDocument, type StatementDocument } from './statementDoc'
import { renderStatementPdf, statementPdfBytes, type TextTrace } from './statementPdf'
import { COLOR, STATEMENT_CONFIG as C } from './statementConfig'
import { formatBalance, formatPaisa, splitBalance } from './statementMoney'
import { registerStatementFont, STATEMENT_FONT } from './statementFont'
import { dubaiOneTransactionSource, referenceStatementSource, REFERENCE_OPTIONS } from './statementReference.fixture'

// Renders in plain Node: jsPDF needs no DOM. The embedded font writes text as glyph ids, so what was printed —
// and exactly where — is read from the renderer's trace rather than out of the bytes.
const AUDIT = { createdBy: 'admin', updatedBy: 'admin' }
const CUST = '5c9ab663-ea1e-4196-85db-a1c4503bd44e'
const customer = { id: CUST, type: 'Customer', name: 'Dubai Tmn Buyer', notes: '', since: '', createdAt: '', updatedAt: '', ...AUDIT } as Account
const NOW = new Date(2026, 8, 21, 14, 5)

function sale(i: number, day: number, o: Partial<Activity> = {}): Activity {
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
    createdAt: `2026-09-${String(10 + day).padStart(2, '0')}T${String(6 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
    updatedAt: '2026-09-15T00:00:00.000Z',
    ...AUDIT,
    ...o,
  } as Activity
}

const build = (n: number, days = 5) =>
  buildStatementDocument({ customer, accounts: [customer], activity: Array.from({ length: n }, (_, i) => sale(i, i % days)), cheques: [], journalEntries: [] }, { now: NOW })
const reference = (o: { includeCurrencySummary?: boolean } = {}) => buildStatementDocument(referenceStatementSource(), { ...REFERENCE_OPTIONS, ...o })
const baseline = () => buildStatementDocument(dubaiOneTransactionSource(), { from: '2026-09-19', to: '2026-09-21', now: new Date(2026, 8, 21, 19, 34) })

function render(d: StatementDocument, o: { grayscale?: boolean } = {}) {
  const trace: TextTrace[] = []
  const doc = renderStatementPdf(d, { compress: false, trace, ...o })
  const pages = doc.getNumberOfPages()
  const onPage = (p: number) => trace.filter((t) => t.page === p)
  const texts = (p?: number) => (p ? onPage(p) : trace).map((t) => t.text)
  return { doc, trace, pages, onPage, texts }
}
const bytesText = (bytes: ArrayBuffer) => new TextDecoder('latin1').decode(new Uint8Array(bytes))

// Geometry, from the config the renderer draws with.
const L = C.margin.left
const R = C.page.width - C.margin.right
const BOTTOM = C.page.height - C.margin.bottom
const colPart = L + C.columns.date
const colRef = colPart + C.columns.particulars
const colBalance = colRef + C.columns.reference + C.columns.debit + C.columns.credit
const isFooter = (t: TextTrace) => t.y > BOTTOM

/** A line of text's box: from a little above the capitals to a little below the baseline. */
const box = (t: TextTrace) => ({ x1: t.x, x2: t.x + t.width, y1: t.y - t.size * 0.3528 * 0.78, y2: t.y + t.size * 0.3528 * 0.2 })
function overlaps(trace: TextTrace[]): string[] {
  const bad: string[] = []
  for (let i = 0; i < trace.length; i++) {
    for (let j = i + 1; j < trace.length; j++) {
      const a = trace[i]
      const b = trace[j]
      if (a.page !== b.page) continue
      const p = box(a)
      const q = box(b)
      if (p.x1 < q.x2 - 0.05 && q.x1 < p.x2 - 0.05 && p.y1 < q.y2 - 0.05 && q.y1 < p.y2 - 0.05) bad.push(`p${a.page}: "${a.text}" overlaps "${b.text}"`)
    }
  }
  return bad
}
/**
 * Separate pieces of text sharing a line, closer than `min` mm. Two runs drawn that close read as one word
 * ("5,000.00Cr", "–1,400,900.57"), which is exactly how a statement comes to say something it does not mean.
 */
function crowded(trace: TextTrace[], min = 1.5): string[] {
  const bad: string[] = []
  const lines = new Map<string, TextTrace[]>()
  for (const t of trace) {
    const k = `${t.page}:${t.y.toFixed(2)}`
    lines.set(k, [...(lines.get(k) ?? []), t])
  }
  for (const line of lines.values()) {
    const sorted = [...line].sort((a, b) => a.x - b.x)
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width)
      // An empty-cell dash right before a figure reads as a minus sign, so it needs far more room than a word does.
      const need = sorted[i - 1].text === '–' || sorted[i].text === '–' ? 6 : min
      if (gap < need) bad.push(`p${sorted[i].page}: "${sorted[i - 1].text}" and "${sorted[i].text}" are ${gap.toFixed(2)} mm apart`)
    }
  }
  return bad
}

/** The balance printed on the same line as a label (a continuity or closing row), digits and side joined. */
function balanceOnLine(t: TextTrace[], label: TextTrace): string {
  const same = t.filter((x) => x.page === label.page && Math.abs(x.y - label.y) < 0.01 && x.x > colBalance - 0.01)
  return same.sort((a, b) => a.x - b.x).map((x) => x.text).join(' ')
}

describe('statement PDF — the file', () => {
  it('is a real A4 portrait PDF with the font embedded, not a viewer-substituted Helvetica', () => {
    const { doc, pages } = render(build(5))
    expect(pages).toBe(1)
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0)
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(297, 0)
    const bytes = bytesText(statementPdfBytes(build(5), { compress: false }))
    expect(bytes.slice(0, 5)).toBe('%PDF-')
    expect(bytes).toContain('/FontFile2')
    // jsPDF declares the standard fonts in every file whether used or not, so check what the text is SET in:
    // every font selection (`/Fn size Tf`) in the page content must name an embedded Noto Sans face.
    const baseFontOf = new Map([...bytes.matchAll(/(\d+) 0 obj\s*<<[^>]*?\/BaseFont \/([^\s/>]+)/g)].map((m) => [m[1], m[2]]))
    const resource = new Map([...bytes.matchAll(/\/(F\d+) (\d+) 0 R/g)].map((m) => [m[1], baseFontOf.get(m[2])]))
    const used = new Set([...bytes.matchAll(/\/(F\d+) [\d.]+ Tf/g)].map((m) => resource.get(m[1])))
    expect(used.size).toBeGreaterThan(0)
    for (const f of used) expect(f).toMatch(/NotoSans/)
  })

  it('has tabular digits, so right-aligned amounts line up decimal point over decimal point', () => {
    const doc = new jsPDF({ unit: 'mm' })
    registerStatementFont(doc)
    for (const style of ['normal', 'bold'] as const) {
      doc.setFont(STATEMENT_FONT, style)
      doc.setFontSize(10)
      const widths = '0123456789'.split('').map((d) => doc.getTextWidth(d.repeat(10)))
      for (const w of widths) expect(w).toBeCloseTo(widths[0], 6)
    }
  })

  it('prints no URL, placeholder name or browser furniture', () => {
    const all = render(build(60)).texts().join('\n')
    for (const bad of ['localhost', 'http://', 'https://', 'about:blank', 'www.', 'DESK NAME']) expect(all.includes(bad), bad).toBe(false)
  })
})

describe('statement PDF — the one-transaction baseline', () => {
  const r = render(baseline())

  it('opens with the business in blue, the title, the customer and the period', () => {
    const name = r.trace.find((t) => t.text === 'Currency Desk' && t.page === 1)!
    expect(name.size).toBeGreaterThanOrEqual(16)
    expect(r.texts(1)).toContain('Statement of Account')
    expect(r.texts(1)).toContain('Dubai Tmn Buyer')
    expect(r.texts(1)).toContain('Account ref. 5C9AB663')
    expect(r.texts(1)).toContain('Statement period')
    expect(r.texts(1)).toContain('19 Sep 2026 to 21 Sep 2026')
  })

  it('says "You owe" over the amount, with no Dr/Cr beside the headline figure', () => {
    const texts = r.texts(1)
    expect(texts).toContain('Closing balance as at 21 Sep 2026')
    expect(texts).toContain('You owe')
    const headline = r.trace.find((t) => t.text === 'PKR 3,807,106.60')!
    expect(headline.size).toBeGreaterThanOrEqual(18)
    expect(headline.size).toBeLessThanOrEqual(22)
    expect(r.trace.some((t) => t.page === 1 && Math.abs(t.y - headline.y) < 0.01 && (t.text === 'Dr' || t.text === 'Cr'))).toBe(false)
    // Opening balance is there, quieter.
    const opening = r.trace.find((t) => t.text === 'PKR 0.00')!
    expect(opening.size).toBeLessThan(headline.size)
  })

  it('keeps the figures: debit 3,807,106.60, credit total 0.00, closing 3,807,106.60 Dr', () => {
    const totals = r.trace.find((t) => t.text === 'Period totals')!
    expect(r.trace.filter((t) => Math.abs(t.y - totals.y) < 0.01).map((t) => t.text)).toEqual(['Period totals', '3,807,106.60', '0.00'])
    expect(balanceOnLine(r.trace, r.trace.find((t) => t.text === 'Closing balance')!)).toBe('3,807,106.60 Dr')
    expect(r.texts()).toContain('Rate: 788 TMN = 1 PKR'.replace(/^/, 'Toman · '))
  })

  it('does not print the currency summary unless asked', () => {
    expect(r.texts()).not.toContain('Currency trading summary')
  })
})

describe('statement PDF — the multipage reference statement', () => {
  const d = reference()
  const r = render(d)

  it('says "We owe you" for a credit balance, and does not repeat the totals in the summary', () => {
    expect(r.texts(1)).toContain('We owe you')
    expect(r.texts(1)).toContain('PKR 1,592,573.67')
    for (const gone of ['Total debits (PKR)', 'Total credits (PKR)', 'Amount payable to customer']) expect(r.texts()).not.toContain(gone)
  })

  it('states the currency once and explains Dr/Cr once, just above the table', () => {
    const all = r.texts()
    expect(all.filter((t) => t === 'All amounts in PKR unless stated otherwise.')).toHaveLength(1)
    expect(all.filter((t) => t.includes('Dr = you owe us') && t.includes('Cr = we owe you'))).toHaveLength(1)
    expect(all.some((t) => t.includes('Pakistani Rupee'))).toBe(false)
    for (const h of ['Date', 'Particulars', 'Reference', 'Debit', 'Credit', 'Balance']) expect(r.texts(1)).toContain(h)
  })

  it('puts the generated time in the footer of every page', () => {
    for (let p = 1; p <= r.pages; p++) {
      const footer = r.onPage(p).filter(isFooter).map((t) => t.text).join(' ')
      expect(footer, `page ${p}`).toContain('Generated 21 Sep 2026, 19:34')
      expect(footer).toContain(`Page ${p} of ${r.pages}`)
    }
  })

  it('writes the rate as an equation in each quote direction, never as a bare "@ 788"', () => {
    const all = r.texts()
    expect(all).toContain('Rate: 1 AED = 79 PKR')
    expect(all).toContain('Toman · Rate: 788 TMN = 1 PKR')
    expect(all.some((t) => / @ \d/.test(t))).toBe(false)
  })

  it('prints period totals and a compact closing row — the figure and its side, no sentence', () => {
    const totals = r.trace.find((t) => t.text === 'Period totals')!
    const closing = r.trace.find((t) => t.text === 'Closing balance')!
    expect(closing.y).toBeGreaterThan(totals.y)
    expect(r.trace.filter((t) => t.page === totals.page && Math.abs(t.y - totals.y) < 0.01).map((t) => t.text)).toEqual(['Period totals', '1,422,242.49', '3,014,816.16'])
    expect(r.trace.filter((t) => t.page === closing.page && Math.abs(t.y - closing.y) < 0.01).map((t) => t.text)).toEqual(['Closing balance', '1,592,573.67', 'Cr'])
  })

  it('lists uncleared cheques with their real statuses, outside the balance, with a total for each direction', () => {
    const all = r.texts()
    expect(all).toContain('Uncleared cheques')
    expect(all).toContain('Not included in the balance above.')
    expect(all).toContain('Deposited')
    expect(all).toContain('From you')
    expect(all).toContain('To you')
    expect(all).toContain('Total from you')
    expect(all).toContain('Total to you')
    expect(all).not.toContain('Cleared')
  })

  it('draws no text on top of other text, none too close to its neighbour, and none outside the margins', () => {
    expect(overlaps(r.trace)).toEqual([])
    expect(crowded(r.trace)).toEqual([])
    for (const t of r.trace) {
      expect(t.x, t.text).toBeGreaterThanOrEqual(L - 1e-6)
      expect(t.x + t.width, t.text).toBeLessThanOrEqual(R + 1e-6)
      if (!isFooter(t)) expect(t.y, `"${t.text}" p${t.page}`).toBeLessThanOrEqual(BOTTOM + 1e-6)
    }
  })

  it('keeps every particulars line a clear gap short of the Reference column', () => {
    const lines = r.trace.filter((t) => Math.abs(t.x - (colPart + C.cellPad)) < 0.01 && !isFooter(t))
    expect(lines.length).toBeGreaterThan(60)
    for (const t of lines) expect(t.x + t.width, t.text).toBeLessThanOrEqual(colRef - C.particularsGap + 1e-6)
  })

  it('never shrinks a figure on an ordinary statement', () => {
    const money = r.trace.filter((t) => /^[\d,]+\.\d\d$/.test(t.text) && t.x > colRef)
    expect(money.length).toBeGreaterThan(100)
    for (const t of money) expect(t.size, t.text).toBeGreaterThanOrEqual(C.font.body)
  })

  it('prints one date per row and fits the reference on three pages', () => {
    expect(r.pages).toBeLessThanOrEqual(3)
    const dates = r.trace.filter((t) => t.x < colPart && /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(t.text) && !isFooter(t))
    expect(dates.length).toBe(d.entryCount + 1) // + the opening row, dated the period start
  })

  it('shows the currency trading summary only when asked, briefly, with quantities and no valuation', () => {
    const on = render(reference({ includeCurrencySummary: true }))
    const all = on.texts()
    expect(all).toContain('Currency trading summary')
    expect(all).toContain('For reference only; not added to your balance.')
    for (const h of ['Currency', 'Bought from you', 'Sold to you', 'Net']) expect(all).toContain(h)
    expect(all).toContain('Net sold to you')
    expect(all.some((t) => /profit|today's value/i.test(t))).toBe(false)
    expect(crowded(on.trace)).toEqual([])
  })
})

describe('statement PDF — pagination', () => {
  it('numbers every page and repeats the table header and the customer on each', () => {
    const r = render(build(120))
    expect(r.pages).toBeGreaterThan(2)
    for (let p = 1; p <= r.pages; p++) {
      expect(r.texts(p), `page ${p}`).toContain(`Page ${p} of ${r.pages}`)
      expect(r.texts(p).filter((t) => t === 'Particulars').length, `table header on page ${p}`).toBe(1)
      if (p > 1) {
        expect(r.texts(p)).toContain('Dubai Tmn Buyer')
        expect(r.texts(p).join(' ')).toContain('Account ref. 5C9AB663')
      }
    }
  })

  it('adds no continuation rows to a single-page statement', () => {
    const r = render(build(5))
    expect(r.texts()).not.toContain('Balance carried forward')
    expect(r.texts()).not.toContain('Balance brought forward')
  })

  it('carries the running balance across every break: carried forward = brought forward = the last row above the break', () => {
    const d = build(130)
    const r = render(d)
    const carried = r.trace.filter((t) => t.text === 'Balance carried forward')
    const brought = r.trace.filter((t) => t.text === 'Balance brought forward')
    expect(carried.length).toBe(r.pages - 1)
    expect(brought.length).toBe(r.pages - 1)
    const balances = d.entries.map((e) => formatBalance(e.balance, 2))
    carried.forEach((c, k) => {
      const b = brought[k]
      expect(b.page).toBe(c.page + 1)
      const carriedFigure = balanceOnLine(r.trace, c)
      expect(balanceOnLine(r.trace, b)).toBe(carriedFigure)
      const above = r.trace.filter((t) => t.page === c.page && t.y < c.y - 0.01 && t.x > colBalance).reduce((a, t) => (t.y > a ? t.y : a), 0)
      const lastRow = r.trace.filter((t) => t.page === c.page && Math.abs(t.y - above) < 0.01 && t.x > colBalance)
      expect(lastRow.sort((a, b) => a.x - b.x).map((t) => t.text).join(' ')).toBe(carriedFigure)
      expect(balances).toContain(carriedFigure)
    })
  })

  it('does not count continuity rows in the totals: the printed totals are the document totals', () => {
    const d = build(130)
    const r = render(d)
    const totals = r.trace.find((t) => t.text === 'Period totals')!
    const onTotals = r.trace.filter((t) => t.page === totals.page && Math.abs(t.y - totals.y) < 0.01).map((t) => t.text)
    expect(onTotals).toEqual(['Period totals', formatPaisa(d.totalDebits, 2), formatPaisa(d.totalCredits, 2)])
    expect(d.entries.reduce((s, e) => s + e.debit, 0)).toBe(d.totalDebits)
  })

  it('never leaves the closing balance alone on a page, for any length', () => {
    for (const n of [20, 22, 24, 26, 28, 30, 32, 34, 36, 50, 60, 62, 64, 66, 68, 70, 72, 90]) {
      const r = render(build(n))
      const closing = r.trace.find((t) => t.text === 'Closing balance')!
      const totals = r.trace.find((t) => t.text === 'Period totals')!
      expect(totals.page, `n=${n}`).toBe(closing.page)
      const rowsWithIt = r.onPage(closing.page).filter((t) => t.x < colPart && /^\d{1,2} Sep 2026$/.test(t.text)).length
      expect(rowsWithIt, `n=${n}: closing on page ${closing.page} with ${rowsWithIt} rows`).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps every row inside the page at every length, with no overlap and no crowding', () => {
    for (const n of [1, 27, 55, 83]) {
      const r = render(build(n))
      expect(overlaps(r.trace), `n=${n}`).toEqual([])
      expect(crowded(r.trace), `n=${n}`).toEqual([])
      for (const t of r.trace) if (!isFooter(t)) expect(t.y, `n=${n} "${t.text}"`).toBeLessThanOrEqual(BOTTOM + 1e-6)
    }
  })
})

describe('statement PDF — hard content', () => {
  const OTHER = '9f1d2c3b-aaaa-4bbb-8ccc-111122223333'
  const narration =
    'Adjustment agreed with the customer over the telephone for the difference on the September Dubai settlement, including the courier charge and the bank handling fee, reference LETTER-2026-09-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  function hard(): StatementDocument {
    const long = { ...customer, name: 'Al-Haramain International General Trading and Money Exchange Company (Private) Limited, Karachi Branch' } as Account
    const activity = [
      sale(1, 1, { currency: 'TMN', amount: 999_000_000_000, rate: 797.25, pkrValue: 1_253_057_384.76 }),
      sale(2, 2, { type: 'purchase', currency: 'USD', amount: 3_000_000, rate: 282.37, pkrValue: 847_110_000 }),
      sale(3, 3, { type: 'receive', amount: 999_999_999.99, pkrValue: 999_999_999.99, method: 'Bank', settlementAccountId: 'b' }),
    ]
    const bankAcct = { id: 'b', type: 'Bank', name: 'Meezan Bank Limited - Current Account 0101-0102030405 (Main Branch, I.I. Chundrigar Road)' } as Account
    const entry = { id: 'e1', ref: 'JV-100234', narration, debitAccount: CUST, creditAccount: 'capital', debitLabel: long.name, creditLabel: 'Capital', amount: 12.5, txnDate: '2026-09-14', createdAt: '2026-09-14T09:00:00.000Z', updatedAt: '', ...AUDIT } as JournalEntry
    const cheques = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`, direction: i % 2 ? 'Inward' : 'Outward', number: `LONG-CHEQUE-NUMBER-${1000 + i}`, party: long.name, customerId: CUST,
      bank: 'Habib Bank Limited, Foreign Exchange Branch', bankAccountId: 'b', amount: 1_000 + i, due: '2026-10-01', status: i % 3 ? 'Pending' : 'Deposited',
      ledgerApplied: false, history: [], createdAt: '', updatedAt: '', ...AUDIT,
    })) as Cheque[]
    return buildStatementDocument({ customer: { ...long, id: CUST }, accounts: [{ ...long, id: CUST }, bankAcct, { id: OTHER } as Account], activity, cheques, journalEntries: [entry] }, { now: NOW })
  }

  it('wraps long names and descriptions instead of cutting them, and prints every word', () => {
    const r = render(hard())
    expect(overlaps(r.trace)).toEqual([])
    expect(crowded(r.trace)).toEqual([])
    const lines = r.trace.filter((t) => Math.abs(t.x - (colPart + C.cellPad)) < 0.01 && !isFooter(t))
    const joined = lines.map((t) => t.text).join(' ').replace(/ /g, '')
    for (const word of narration.split(' ')) expect(joined, word).toContain(word)
    expect(r.trace.some((t) => t.text.includes('...'))).toBe(false)
    for (const t of lines) expect(t.x + t.width, t.text).toBeLessThanOrEqual(colRef - C.particularsGap + 1e-6)
    expect(r.texts(1).join(' ')).toContain('Karachi Branch')
  })

  it('fits very large amounts in their columns, shrinking a figure only as far as the minimum size', () => {
    const d = hard()
    const r = render(d)
    const big = formatPaisa(d.entries.find((e) => e.debit > 100_000_000_000)!.debit, 2)
    const drawn = r.trace.filter((t) => t.text === big)
    expect(drawn.length).toBeGreaterThan(0)
    for (const t of drawn) expect(t.size).toBeGreaterThanOrEqual(C.minFigureSize)
    for (const t of r.trace) {
      expect(t.x, t.text).toBeGreaterThanOrEqual(L - 1e-6)
      expect(t.x + t.width, t.text).toBeLessThanOrEqual(R + 1e-6)
    }
    expect(r.texts()).toContain(`PKR ${splitBalance(d.closing, 2).amount}`)
  })

  it('runs a long cheque list over a page break with its column heads repeated, totals kept with the last row', () => {
    const r = render(hard())
    expect(r.trace.filter((t) => t.text === 'Cheque No.').length).toBeGreaterThan(1)
    const lastCheque = r.trace.filter((t) => t.text === 'From you' || t.text === 'To you').at(-1)!
    const totals = r.trace.find((t) => t.text === 'Total from you')!
    expect(totals.page).toBe(lastCheque.page)
    const numberX = Math.min(...r.trace.filter((t) => t.text === 'Cheque No.').map((t) => t.x))
    const numberText = r.trace.filter((t) => Math.abs(t.x - numberX) < 0.01 && t.text !== 'Cheque No.').map((t) => t.text).join('')
    for (let i = 0; i < 40; i++) expect(numberText).toContain(`LONG-CHEQUE-NUMBER-${1000 + i}`)
    for (const t of r.trace) if (!isFooter(t)) expect(t.y, t.text).toBeLessThanOrEqual(BOTTOM + 1e-6)
  })
})

describe('statement PDF — an empty statement', () => {
  const d = buildStatementDocument({ customer, accounts: [customer], activity: [], cheques: [], journalEntries: [] }, { now: NOW })
  const r = render(d)

  it('is one page that says there is nothing in the period and the account is settled', () => {
    expect(r.pages).toBe(1)
    expect(r.texts()).toContain('No transactions in this period.')
    expect(r.texts()).toContain('Account settled')
    expect(r.texts()).toContain('PKR 0.00')
    const totals = r.trace.find((t) => t.text === 'Period totals')!
    // Zero totals print as 0.00, never as a dash.
    expect(r.trace.filter((t) => Math.abs(t.y - totals.y) < 0.01).map((t) => t.text)).toEqual(['Period totals', '0.00', '0.00'])
    expect(r.texts()).toContain('Up to 21 Sep 2026')
  })

  it('leaves out the sections it has nothing for', () => {
    expect(r.texts()).not.toContain('Currency trading summary')
    expect(r.texts()).not.toContain('Uncleared cheques')
  })
})

describe('statement PDF — black and white', () => {
  const stream = (o: { grayscale?: boolean } = {}) => bytesText(statementPdfBytes(reference(), { compress: false, ...o }))
  /** Every colour the page sets, as [r, g, b] in 0-1: jsPDF writes `r g b rg` (fill and text) and `r g b RG` (stroke). */
  const colours = (text: string) => [...text.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (?:rg|RG)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])])

  it('uses the blue accent, and no red or green anywhere on the page', () => {
    const cs = colours(stream())
    const [r0, g0, b0] = COLOR.brand.map((v) => v / 255)
    expect(cs.some(([x, y, z]) => Math.abs(x - r0) < 0.003 && Math.abs(y - g0) < 0.003 && Math.abs(z - b0) < 0.003)).toBe(true)
    for (const [r, g, b] of cs) {
      expect(b, 'no colour leans red').toBeGreaterThanOrEqual(r - 0.002)
      expect(b, 'no colour leans green').toBeGreaterThanOrEqual(g - 0.002)
    }
  })

  it('renders in pure greys when asked, for a black-and-white proof', () => {
    const gray = stream({ grayscale: true })
    expect([...gray.matchAll(/(?:^|\s)([\d.]+) (?:g|G)(?=\s)/g)].length).toBeGreaterThan(20)
    expect(colours(gray)).toEqual([])
  })

  it('writes the side of every ledger balance, so none depends on colour', () => {
    const r = render(reference())
    const end = r.trace.find((t) => t.text === 'Uncleared cheques')!
    const inLedger = (t: TextTrace) => t.page < end.page || (t.page === end.page && t.y < end.y)
    const balances = r.trace.filter((t) => inLedger(t) && /^[\d,]+\.\d\d$/.test(t.text) && t.x > colBalance)
    expect(balances.length).toBeGreaterThan(60)
    for (const b of balances) {
      if (b.text === '0.00') continue
      expect(r.trace.some((t) => t.page === b.page && Math.abs(t.y - b.y) < 0.01 && (t.text === 'Dr' || t.text === 'Cr')), `${b.text} on p${b.page}`).toBe(true)
    }
  })
})
