import { describe, it, expect } from 'vitest'
import { jsPDF } from 'jspdf'
import type { Account, Activity, Cheque, JournalEntry } from './engine'
import { buildStatementDocument, type StatementDocument } from './statementDoc'
import { renderStatementPdf, statementPdfBytes, type TextTrace } from './statementPdf'
import { COLOR, STATEMENT_CONFIG as C } from './statementConfig'
import { formatBalance, formatPaisa, splitBalance } from './statementMoney'
import { registerStatementFont, STATEMENT_FONT } from './statementFont'
import { referenceStatementSource, REFERENCE_OPTIONS } from './statementReference.fixture'

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
const reference = () => buildStatementDocument(referenceStatementSource(), REFERENCE_OPTIONS)

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
const colVoucher = colPart + C.columns.particulars
const colBalRight = R - C.cellPad
const FOOTER = C.font.footer
const isFooter = (t: TextTrace) => t.size <= FOOTER + 1e-9 && t.y > BOTTOM

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

/** The balance printed on the same line as a label (a continuity or closing row), digits and side joined. */
function balanceOnLine(t: TextTrace[], label: TextTrace): string {
  const same = t.filter((x) => x.page === label.page && Math.abs(x.y - label.y) < 0.01 && x.x > colVoucher + C.columns.debit + C.columns.credit - 0.01)
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

  it('prints no address, URL or browser furniture', () => {
    const all = render(build(60)).texts().join('\n')
    for (const bad of ['localhost', 'http://', 'https://', 'about:blank', 'www.']) expect(all.includes(bad), bad).toBe(false)
  })
})

describe('statement PDF — the reference statement', () => {
  const r = render(reference())
  const d = reference()

  it('shows opening, both totals and the closing balance — with its meaning — at the top of page 1', () => {
    const p1 = r.texts(1)
    for (const label of ['Opening balance (PKR)', 'Total debits (PKR)', 'Total credits (PKR)', 'Closing balance (PKR)']) expect(p1).toContain(label)
    for (const figure of ['0.00', '1,422,242.49', '3,014,816.16', '1,592,573.67']) expect(p1).toContain(figure)
    expect(p1).toContain('Amount payable to customer')
    // The closing figure is the largest on the page, and its side is written, not coloured.
    const closing = r.onPage(1).find((t) => t.text === '1,592,573.67')!
    expect(closing.size).toBe(Math.max(...r.onPage(1).filter((t) => /\d/.test(t.text)).map((t) => t.size)))
    expect(r.onPage(1).some((t) => t.text === 'Cr' && Math.abs(t.y - closing.y) < 0.01)).toBe(true)
  })

  it('explains Dr and Cr once, in words, and names the account currency', () => {
    const p1 = r.texts(1).join(' ')
    expect(p1).toContain('Dr: the customer owes the business. Cr: the business owes the customer.')
    expect(p1).toContain('PKR (Pakistani Rupee)')
    for (const h of ['Debit (PKR)', 'Credit (PKR)', 'Balance (PKR)']) expect(r.texts(1)).toContain(h)
  })

  it('labels the header facts and omits contact details that do not exist', () => {
    const p1 = r.texts(1)
    for (const label of ['Customer', 'Account ID', 'Statement period', 'Account currency', 'Generated']) expect(p1).toContain(label)
    expect(p1).toContain('Statement Test Customer')
    expect(p1).toContain('15 Sep 2026 to 21 Sep 2026')
    expect(p1).toContain('21 Sep 2026, 19:34')
    expect(p1.some((t) => t.startsWith('Tel.'))).toBe(false)
  })

  it('spells out both rate directions exactly as each currency is priced', () => {
    const all = r.texts()
    expect(all).toContain('UAE Dirham · Rate: PKR 79 per AED')
    expect(all).toContain('Toman · Rate: 788 TMN per PKR')
    expect(all.some((t) => / @ \d/.test(t))).toBe(false)
  })

  it('prints the period totals and the closing balance as separate rows', () => {
    const totals = r.trace.find((t) => t.text === 'Period totals')!
    const closing = r.trace.find((t) => t.text === 'Closing balance')!
    expect(closing.y).toBeGreaterThan(totals.y)
    const onTotals = r.trace.filter((t) => t.page === totals.page && Math.abs(t.y - totals.y) < 0.01).map((t) => t.text)
    expect(onTotals).toEqual(['Period totals', '1,422,242.49', '3,014,816.16'])
    expect(balanceOnLine(r.trace, closing)).toBe('1,592,573.67 Cr')
    expect(r.trace.some((t) => t.page === closing.page && t.text === 'Amount payable to customer' && t.y > closing.y)).toBe(true)
  })

  it('titles the currency section as a trading summary and says it is not an amount payable', () => {
    const all = r.texts()
    expect(all).toContain('Currency Trading Summary')
    expect(all.join(' ')).toContain('Trading summary only. These figures are not an additional amount payable.')
    expect(all).toContain('Net sold to customer')
    expect(all).not.toContain('Currency Position')
  })

  it('lists uncleared cheques under their own title, saying they are outside the balance, with both totals', () => {
    const all = r.texts()
    expect(all).toContain('Uncleared Cheques')
    expect(all.join(' ')).toContain('These cheques are not included in the account balance until cleared.')
    expect(all).toContain('Deposited')
    expect(all).toContain('Total received from customer (uncleared)')
    expect(all).toContain('Total issued to customer (uncleared)')
    expect(all).not.toContain('Cleared')
  })

  it('draws no text on top of other text, and none outside the margins or into the footer', () => {
    expect(overlaps(r.trace)).toEqual([])
    for (const t of r.trace) {
      expect(t.x, t.text).toBeGreaterThanOrEqual(L - 1e-6)
      expect(t.x + t.width, t.text).toBeLessThanOrEqual(R + 1e-6)
      if (!isFooter(t)) expect(t.y, `"${t.text}" p${t.page}`).toBeLessThanOrEqual(BOTTOM + 1e-6)
    }
  })

  it('never shrinks a figure on an ordinary statement', () => {
    const money = r.trace.filter((t) => /^[\d,]+\.\d\d$/.test(t.text) && t.x > colVoucher)
    expect(money.length).toBeGreaterThan(100)
    for (const t of money) expect(t.size, t.text).toBeGreaterThanOrEqual(C.font.body)
  })

  it('keeps the whole ledger on the pages it needs and uses the space after it for the sections', () => {
    expect(r.pages).toBeLessThanOrEqual(4)
    const lastLedger = r.trace.find((t) => t.text === 'Closing balance')!.page
    const firstSection = r.trace.find((t) => t.text === 'Currency Trading Summary')!.page
    expect(firstSection - lastLedger).toBeLessThanOrEqual(1)
    // Rows printed = entries in the document: one date per row, in the date column.
    const dates = r.trace.filter((t) => t.x < colPart && /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(t.text))
    expect(dates.length).toBe(d.entryCount + 1) // + the opening row, dated the period start
  })
})

describe('statement PDF — pagination', () => {
  it('numbers every page "Page X of Y" and repeats the table header on every ledger page', () => {
    const r = render(build(120))
    expect(r.pages).toBeGreaterThan(2)
    for (let p = 1; p <= r.pages; p++) {
      expect(r.texts(p), `page ${p}`).toContain(`Page ${p} of ${r.pages}`)
      expect(r.texts(p).filter((t) => t === 'Particulars').length, `table header on page ${p}`).toBe(1)
      if (p > 1) expect(r.texts(p).join(' '), `continuation header on page ${p}`).toContain('Account ID 5C9AB663')
    }
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
      // The last entry balance printed above the carried row, on that page.
      const above = r.trace
        .filter((t) => t.page === c.page && t.y < c.y - 0.01 && t.x + t.width > colBalRight - C.columns.balance && t.x > colVoucher + C.columns.debit + C.columns.credit)
        .reduce((a, t) => (t.y > a ? t.y : a), 0)
      const lastRow = r.trace.filter((t) => t.page === c.page && Math.abs(t.y - above) < 0.01 && t.x > colVoucher + C.columns.debit + C.columns.credit)
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

  it('keeps every row inside the page at every length, with no overlap', () => {
    for (const n of [1, 27, 55, 83]) {
      const r = render(build(n))
      expect(overlaps(r.trace), `n=${n}`).toEqual([])
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
    // The narration, reassembled from its wrapped lines in the particulars column, is complete.
    const lines = r.trace.filter((t) => Math.abs(t.x - (colPart + C.cellPad)) < 0.01 && narration.includes(t.text.trim().split(' ')[0]) && t.y > 60)
    const joined = lines.map((t) => t.text).join(' ').replace(/\s+/g, ' ')
    for (const word of narration.split(' ')) expect(joined.replace(/ /g, ''), word).toContain(word)
    expect(r.trace.some((t) => t.text.includes('...'))).toBe(false)
    // Every particulars line stays inside its column.
    for (const t of r.trace.filter((x) => Math.abs(x.x - (colPart + C.cellPad)) < 0.01 && x.y > 60 && !isFooter(x))) {
      expect(t.x + t.width, t.text).toBeLessThanOrEqual(colVoucher + 1e-6)
    }
    // The full customer name is on page 1.
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
    expect(r.texts()).toContain(splitBalance(d.closing, 2).amount)
  })

  it('runs a long cheque list over a page break with its column heads repeated, totals kept with the last row', () => {
    const r = render(hard())
    const heads = r.trace.filter((t) => t.text === 'Cheque No.')
    expect(heads.length).toBeGreaterThan(1)
    // Each cheque row starts with its direction; the last one printed must share a page with the totals.
    const lastCheque = r.trace.filter((t) => t.text === 'Received from customer' || t.text === 'Issued to customer').at(-1)!
    const totals = r.trace.find((t) => t.text === 'Total received from customer (uncleared)')!
    expect(totals.page).toBe(lastCheque.page)
    // A cheque number too long for its column wraps; every one is printed whole.
    const numberX = Math.min(...r.trace.filter((t) => t.text === 'Cheque No.').map((t) => t.x))
    const numberText = r.trace.filter((t) => Math.abs(t.x - numberX) < 0.01 && t.text !== 'Cheque No.').map((t) => t.text).join('')
    for (let i = 0; i < 40; i++) expect(numberText).toContain(`LONG-CHEQUE-NUMBER-${1000 + i}`)
    for (const t of r.trace) if (!isFooter(t)) expect(t.y, t.text).toBeLessThanOrEqual(BOTTOM + 1e-6)
  })
})

describe('statement PDF — an empty statement', () => {
  const d = buildStatementDocument({ customer, accounts: [customer], activity: [], cheques: [], journalEntries: [] }, { now: NOW })
  const r = render(d)

  it('is one page that says there is nothing in the period and shows a settled account', () => {
    expect(r.pages).toBe(1)
    expect(r.texts()).toContain('No transactions in this period.')
    expect(r.texts()).toContain('Period totals')
    expect(r.texts().filter((t) => t === 'Account settled — no outstanding balance').length).toBeGreaterThanOrEqual(2)
    expect(r.texts()).toContain('Up to 21 Sep 2026')
  })

  it('leaves out the sections it has nothing for', () => {
    expect(r.texts()).not.toContain('Currency Trading Summary')
    expect(r.texts()).not.toContain('Uncleared Cheques')
  })
})

describe('statement PDF — black and white', () => {
  const stream = (o: { grayscale?: boolean } = {}) => bytesText(statementPdfBytes(reference(), { compress: false, ...o }))
  /** Every colour the page sets, as [r, g, b] in 0-1: jsPDF writes `r g b rg` (fill and text) and `r g b RG` (stroke). */
  const colours = (text: string) => [...text.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (?:rg|RG)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])])

  it('uses the navy accent, and no red or green anywhere on the page', () => {
    const cs = colours(stream())
    const [r0, g0, b0] = COLOR.brand.map((v) => v / 255)
    expect(cs.some(([x, y, z]) => Math.abs(x - r0) < 0.003 && Math.abs(y - g0) < 0.003 && Math.abs(z - b0) < 0.003)).toBe(true)
    for (const [r, g, b] of cs) {
      expect(b, 'no colour leans red').toBeGreaterThanOrEqual(r - 0.002)
      expect(b, 'no colour leans green').toBeGreaterThanOrEqual(g - 0.002)
    }
  })

  it('renders in pure greys when asked, for a black-and-white proof', () => {
    // jsPDF writes an all-equal colour as a single-value grey operator (`0.4 g` / `0.4 G`) and only a genuine
    // colour as three components (`r g b rg`). So a grayscale render must have many grey operators and no
    // three-component colour at all.
    const gray = stream({ grayscale: true })
    expect([...gray.matchAll(/(?:^|\s)([\d.]+) (?:g|G)(?=\s)/g)].length).toBeGreaterThan(20)
    expect(colours(gray)).toEqual([])
  })

  it('writes the side of every balance, so none depends on colour', () => {
    const r = render(reference())
    // Every figure in the Balance column of the ledger — which ends where the first section begins.
    const end = r.trace.find((t) => t.text === 'Currency Trading Summary')!
    const inLedger = (t: TextTrace) => t.page < end.page || (t.page === end.page && t.y < end.y)
    const balances = r.trace.filter((t) => inLedger(t) && t.y > 80 && /^[\d,]+\.\d\d$/.test(t.text) && t.x > colVoucher + C.columns.debit + C.columns.credit)
    expect(balances.length).toBeGreaterThan(60)
    for (const b of balances) {
      if (b.text === '0.00') continue
      expect(r.trace.some((t) => t.page === b.page && Math.abs(t.y - b.y) < 0.01 && (t.text === 'Dr' || t.text === 'Cr')), `${b.text} on p${b.page}`).toBe(true)
    }
  })
})
