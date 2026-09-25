import { jsPDF } from 'jspdf'
import { COLOR, STATEMENT_CONFIG, type RGB, type StatementConfig } from './statementConfig'
import { layoutLedger, layoutSections, type LedgerItem, type SectionItem } from './statementLayout'
import { formatPaisa, splitBalance } from './statementMoney'
import { NO_ENTRIES_LABEL, OPENING_LABEL, type StatementDocument, type StatementEntry } from './statementDoc'
import { registerStatementFont, STATEMENT_FONT } from './statementFont'

// ---------------------------------------------------------------------------
// Draws a StatementDocument onto portrait A4
// ---------------------------------------------------------------------------
//
// Decides only WHERE things go and how they look. What the statement says — every figure, every
// description — was settled in statementDoc.ts, in plain data; the arithmetic of the page breaks is in
// statementLayout.ts; the palette and every dimension are in statementConfig.ts. This file is the part
// that touches jsPDF, and the only one that does, so it is loaded lazily (the Print button `import()`s it)
// and the library is never part of the main bundle.
//
// THE DOCUMENT, top to bottom: a compact business header; the customer and period; ONE summary area whose
// primary fact is the closing balance in words ("You owe" / "We owe you" / "Account settled") with the
// opening balance quieter beside it; the ledger; period totals and a compact closing row; uncleared cheques
// only when there are any; the currency trading summary only when asked for; a footer with the generated
// time and "Page X of Y". Colour never carries meaning — every direction is written — so a black-and-white
// copy loses nothing (`grayscale: true` renders exactly that, for checking).
//
// TEXT NEVER CLIPS OR TOUCHES. Descriptive text wraps and the row grows (rows are measured before layout);
// a figure too wide for its column is set slightly smaller, down to `minFigureSize`. Particulars stop a
// clear gap short of the Reference column, and a Dr/Cr sits in its own slot a clear gap after its digits,
// so no two words ever run together.

export interface TextTrace {
  page: number
  text: string
  /** Left edge, mm — whatever the alignment the text was drawn with. */
  x: number
  /** Baseline, mm. */
  y: number
  width: number
  size: number
  bold: boolean
}

export interface RenderOptions {
  config?: StatementConfig
  /** Compressed streams are smaller; uncompressed lets a test read colour operators straight out of the bytes. */
  compress?: boolean
  /** Renders every colour as its grey, to see what a black-and-white printer will make of it. */
  grayscale?: boolean
  /**
   * Receives every piece of text drawn, with its page and position. The embedded font writes text as glyph
   * ids, so this — not the bytes — is how a test reads what was printed and where.
   */
  trace?: TextTrace[]
}

const MM_PER_PT = 0.3528
/** Cap height of Noto Sans, as a fraction of the type size — used to centre a line's capitals in its line box. */
const CAP_HEIGHT = 0.714
/** Width held at the right of the Balance column for "Dr"/"Cr", so the digits align with or without one. */
const SIDE_SLOT = 5.5
/** The least space kept between a right-aligned figure and the column to its left. */
const GUTTER = 0.5
/** An unused Debit or Credit cell. An en dash, light, so an empty cell reads as empty rather than missing. */
const EMPTY_CELL = '–'

export function renderStatementPdf(d: StatementDocument, opts: RenderOptions = {}): jsPDF {
  const C = opts.config ?? STATEMENT_CONFIG
  const F = C.font
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: opts.compress ?? true })
  registerStatementFont(doc)
  doc.setProperties({ title: `${d.title} - ${d.customerName}`, subject: d.title, creator: d.business.name })

  const PW = C.page.width
  const PH = C.page.height
  const L = C.margin.left
  const R = PW - C.margin.right
  const W = R - L
  const PAD = C.cellPad
  const cw = C.columns
  const col = {
    date: L,
    part: L + cw.date,
    ref: L + cw.date + cw.particulars,
    debit: L + cw.date + cw.particulars + cw.reference,
    credit: L + cw.date + cw.particulars + cw.reference + cw.debit,
    bal: L + cw.date + cw.particulars + cw.reference + cw.debit + cw.credit,
  }
  /** Room for a right-aligned figure in a column: all of it but the right pad and a small gutter. */
  const figW = (w: number) => w - PAD - GUTTER
  const cur = d.accountCurrency.code
  const dec = d.decimals
  const money = (p: number) => formatPaisa(p, dec)

  // ------------------------------------------------------------------ drawing primitives
  const tone = (c: RGB): RGB => {
    if (!opts.grayscale) return c
    const y = Math.round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])
    return [y, y, y]
  }
  let curSize: number = F.body
  let curBold = false
  const font = (bold: boolean, size: number, color: RGB = COLOR.ink) => {
    doc.setFont(STATEMENT_FONT, bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    const c = tone(color)
    doc.setTextColor(c[0], c[1], c[2])
    curSize = size
    curBold = bold
  }
  /** Draws text and records it in the trace. `x` is the anchor for the alignment given. */
  const put = (text: string, x: number, y: number, align: 'left' | 'right' = 'left') => {
    if (!text) return
    const width = doc.getTextWidth(text)
    doc.text(text, x, y, align === 'right' ? { align: 'right' } : undefined)
    opts.trace?.push({ page: doc.getCurrentPageInfo().pageNumber, text, x: align === 'right' ? x - width : x, y, width, size: curSize, bold: curBold })
  }
  const hrule = (x1: number, y: number, x2: number, color: RGB, width: number) => {
    const c = tone(color)
    doc.setDrawColor(c[0], c[1], c[2])
    doc.setLineWidth(width)
    doc.line(x1, y, x2, y)
  }
  const fill = (x: number, y: number, w: number, h: number, color: RGB) => {
    const c = tone(color)
    doc.setFillColor(c[0], c[1], c[2])
    doc.rect(x, y, w, h, 'F')
  }
  const lineH = (size: number) => size * MM_PER_PT * C.leading
  /** Baseline of a line of `size` pt whose line box starts at `top`: its capitals centred in the box. */
  const baseline = (top: number, size: number) => top + lineH(size) / 2 + (size * MM_PER_PT * CAP_HEIGHT) / 2
  /** Baseline that centres one line of `size` pt in a band of height `h` starting at `top`. */
  const centred = (top: number, h: number, size: number) => top + h / 2 + (size * MM_PER_PT * CAP_HEIGHT) / 2
  /** Word-wraps `text` to `maxW` at the given face; a single word too long for the line is broken, never cut. */
  const wrap = (text: string, bold: boolean, size: number, maxW: number): string[] => {
    if (!text) return []
    font(bold, size)
    return doc.splitTextToSize(text, maxW) as string[]
  }
  /** The size, at most `size`, at which `text` fits `maxW` — figures shrink rather than clip. */
  const fitSize = (text: string, bold: boolean, size: number, maxW: number): number => {
    let s = size
    font(bold, s)
    while (s > C.minFigureSize && doc.getTextWidth(text) > maxW) {
      s = Math.max(C.minFigureSize, s - 0.25)
      font(bold, s)
    }
    return s
  }
  /** A figure right-aligned to `right`, shrunk if it must be to stay inside `maxW`. */
  const figure = (text: string, right: number, y: number, maxW: number, bold = false, size: number = F.body, color: RGB = COLOR.ink) => {
    const s = fitSize(text, bold, size, maxW)
    font(bold, s, color)
    put(text, right, y, 'right')
  }
  /** A ledger balance: digits right-aligned to a fixed edge, "Dr"/"Cr" in its own slot a clear gap beyond it. */
  const balanceCell = (net: number, y: number, bold: boolean) => {
    const { amount, side } = splitBalance(net, dec)
    const right = col.bal + cw.balance - PAD
    figure(amount, right - SIDE_SLOT, y, figW(cw.balance) - SIDE_SLOT, bold)
    if (side) {
      font(false, F.side, COLOR.detail)
      put(side, right, y, 'right')
    }
  }
  /**
   * An unused Debit/Credit cell: a light dash CENTRED in the cell. Right-aligned it would sit against the
   * next column's figure and read as a minus sign ("– 1,400,900.57").
   */
  const emptyCell = (left: number, width: number, y: number) => {
    font(false, F.body, COLOR.light)
    put(EMPTY_CELL, left + width / 2 - doc.getTextWidth(EMPTY_CELL) / 2, y)
  }
  const rowRule = (y: number) => hrule(L, y, R, COLOR.rule, 0.15)

  // ------------------------------------------------------------------ page 1: header, customer, summary
  function drawFirstHeader(): number {
    let y = C.margin.top
    // A. The business (blue) and the document title, on one line.
    const nameLines = wrap(d.business.name, true, F.business, W * 0.55)
    nameLines.forEach((line, i) => {
      font(true, F.business, COLOR.brand)
      put(line, L, baseline(y + i * lineH(F.business), F.business))
    })
    font(true, F.title, COLOR.ink)
    put(d.title, R, baseline(y, F.business), 'right')
    y += Math.max(1, nameLines.length) * lineH(F.business)
    // Contact details only when they exist — nothing is invented to fill the space.
    for (const line of wrap(d.business.contactLine, false, F.label, W * 0.6)) {
      font(false, F.label, COLOR.light)
      put(line, L, baseline(y, F.label))
      y += lineH(F.label)
    }
    y += 1.5
    hrule(L, y, R, COLOR.brand, 0.5)
    y += 5

    // B. Whose account, and which period.
    const custLines = wrap(d.customerName, true, F.customer, W * 0.6)
    const custTop = y
    custLines.forEach((line, i) => {
      font(true, F.customer, COLOR.ink)
      put(line, L, baseline(y + i * lineH(F.customer), F.customer))
    })
    y += custLines.length * lineH(F.customer)
    font(false, F.label, COLOR.light)
    put(`Account ref. ${d.accountRef}`, L, baseline(y, F.label))
    y += lineH(F.label)
    font(false, F.label, COLOR.light)
    put('Statement period', R, baseline(custTop, F.label), 'right')
    font(false, F.body, COLOR.ink)
    put(d.periodLabel, R, baseline(custTop + lineH(F.label), F.body), 'right')
    y = Math.max(y, custTop + lineH(F.label) + lineH(F.body)) + 4

    // C. The summary: the closing balance in words is the primary fact; the opening balance is quieter.
    const top = y
    const inset = 4.5
    const h = 3.6 + lineH(F.label) + 0.8 + lineH(F.direction) + lineH(F.balance) + 3
    fill(L, top, W, h, COLOR.tint)
    let sy = top + 3.6
    font(false, F.label, COLOR.light)
    put(`Closing balance as at ${d.asAtLabel}`, L + inset, baseline(sy, F.label))
    sy += lineH(F.label) + 0.8
    font(true, F.direction, COLOR.ink)
    put(d.closingLabel, L + inset, baseline(sy, F.direction))
    sy += lineH(F.direction)
    const closingAmount = `${cur} ${splitBalance(d.closing, dec).amount}`
    const bs = fitSize(closingAmount, true, F.balance, W * 0.6)
    font(true, bs, COLOR.ink)
    put(closingAmount, L + inset, baseline(sy, F.balance))

    const oy = top + 3.6
    font(false, F.label, COLOR.light)
    put('Opening balance', R - inset, baseline(oy, F.label), 'right')
    font(false, F.body, COLOR.ink)
    put(`${cur} ${splitBalance(d.opening, dec).amount}`, R - inset, baseline(oy + lineH(F.label), F.body), 'right')
    if (d.openingNote) {
      font(false, F.label, COLOR.detail)
      put(d.openingNote, R - inset, baseline(oy + lineH(F.label) + lineH(F.body), F.label), 'right')
    }
    y = top + h + 4.5

    // The account currency, stated once, and what Dr and Cr mean, stated once — right above the table.
    font(false, F.note, COLOR.light)
    put(`All amounts in ${cur} unless stated otherwise.`, L, baseline(y, F.note))
    put('Dr = you owe us  ·  Cr = we owe you', R, baseline(y, F.note), 'right')
    return y + lineH(F.note) + 1.2
  }

  // Later pages: the customer, the account and the period — so a loose page is still identifiable.
  const contTop = C.margin.top - 2
  const contName = wrap(d.customerName, true, F.body, W * 0.62)
  function drawContinuationHeader(): void {
    contName.forEach((line, i) => {
      font(true, F.body, COLOR.ink)
      put(line, L, baseline(contTop + i * lineH(F.body), F.body))
    })
    font(true, F.label, COLOR.brand)
    put(d.business.name, R, baseline(contTop, F.body), 'right')
    const y2 = contTop + contName.length * lineH(F.body)
    font(false, F.label, COLOR.light)
    put(`Account ref. ${d.accountRef}  ·  ${d.periodLabel}`, L, baseline(y2, F.label))
    put(`${d.title}  ·  amounts in ${cur}`, R, baseline(y2, F.label), 'right')
    hrule(L, y2 + lineH(F.label) + 1, R, COLOR.brand, 0.35)
  }
  const laterTop = contTop + contName.length * lineH(F.body) + lineH(F.label) + 4.4

  function drawTableHead(y: number): void {
    const h = C.row.tableHead
    fill(L, y, W, h, COLOR.tint)
    const ty = centred(y, h, F.tableHead)
    font(true, F.tableHead, COLOR.ink)
    put('Date', col.date + PAD, ty)
    put('Particulars', col.part + PAD, ty)
    put('Reference', col.ref + PAD, ty)
    put('Debit', col.debit + cw.debit - PAD, ty, 'right')
    put('Credit', col.credit + cw.credit - PAD, ty, 'right')
    put('Balance', col.bal + cw.balance - PAD, ty, 'right')
    hrule(L, y + h, R, COLOR.ink, 0.3)
  }

  // ------------------------------------------------------------------ measure the ledger rows
  // Particulars stop a clear gap short of the Reference column, so the two never read as one.
  const partW = cw.particulars - PAD - C.particularsGap
  interface MeasuredEntry {
    entry: StatementEntry
    part: string[]
    detail: string[]
    ref: string[]
    height: number
  }
  const measure = (e: StatementEntry): MeasuredEntry => {
    const part = wrap(e.particulars, false, F.body, partW)
    const detail = wrap(e.detail, false, F.secondary, partW)
    const ref = wrap(e.reference, false, F.reference, cw.reference - 2 * PAD)
    // A row is as tall as its text: one line where there is one line, two where a deal carries its rate.
    const textH = Math.max(part.length * lineH(F.body) + detail.length * lineH(F.secondary), ref.length * lineH(F.reference), lineH(F.body))
    return { entry: e, part, detail, ref, height: textH + 2 * C.rowPad }
  }
  const measured = d.entries.map(measure)
  const singleRow = lineH(F.body) + 2 * C.rowPad

  // items: opening, entries (or one "no transactions" row), totals, closing — and the balance after each.
  const items: LedgerItem[] = [{ kind: 'opening', height: singleRow }]
  const balanceAfter: number[] = [d.opening]
  if (measured.length) {
    for (const m of measured) {
      items.push({ kind: 'entry', height: m.height })
      balanceAfter.push(m.entry.balance)
    }
  } else {
    items.push({ kind: 'entry', height: singleRow })
    balanceAfter.push(d.opening)
  }
  items.push({ kind: 'totals', height: C.row.totals })
  balanceAfter.push(d.closing)
  items.push({ kind: 'closing', height: C.row.closing })
  balanceAfter.push(d.closing)

  // ------------------------------------------------------------------ measure the sections
  const sectionItems: SectionItem[] = []
  const sectionDraw: ((y: number) => void)[] = []
  const repeatHeights: number[] = []
  const repeatDraw: ((y: number) => void)[] = []
  const bottom = PH - C.margin.bottom

  /** A section's title, its one short note, and its column heads — drawn as one block, kept with the first row. */
  const sectionHeading = (title: string, note: string, colHead: (y: number) => void) => {
    const h = C.row.sectionHead + lineH(F.note) + 1.6 + C.row.tableHead
    const draw = (y: number) => {
      font(true, F.section, COLOR.brand)
      put(title, L, y + C.row.sectionHead - 2)
      font(false, F.note, COLOR.light)
      put(note, L, baseline(y + C.row.sectionHead, F.note))
      colHead(y + C.row.sectionHead + lineH(F.note) + 1.6)
    }
    return { h, draw }
  }
  const colHeadBand = (y: number, cells: { text: string; x: number; right?: boolean }[]) => {
    const h = C.row.tableHead
    fill(L, y, W, h, COLOR.tint)
    const ty = centred(y, h, F.tableHead)
    font(true, F.tableHead, COLOR.ink)
    for (const c of cells) put(c.text, c.x, ty, c.right ? 'right' : 'left')
    hrule(L, y + h, R, COLOR.ink, 0.3)
  }

  let sectionNo = 0
  if (d.pendingCheques.length) {
    const s = sectionNo++
    const w = { dir: 30, num: 34, bank: 48, due: 26, status: 22, amt: 26 }
    const x = {
      dir: L + PAD,
      num: L + w.dir + PAD,
      bank: L + w.dir + w.num + PAD,
      due: L + w.dir + w.num + w.bank + PAD,
      status: L + w.dir + w.num + w.bank + w.due + PAD,
      amt: R - PAD,
    }
    const heads = [
      { text: 'Direction', x: x.dir },
      { text: 'Cheque No.', x: x.num },
      { text: 'Bank', x: x.bank },
      { text: 'Due date', x: x.due },
      { text: 'Status', x: x.status },
      { text: 'Amount', x: x.amt, right: true },
    ]
    const head = sectionHeading('Uncleared cheques', 'Not included in the balance above.', (y) => colHeadBand(y, heads))
    sectionItems.push({ section: s, height: head.h, keepWithNext: true })
    sectionDraw.push(head.draw)
    repeatHeights[s] = C.row.tableHead
    repeatDraw[s] = (y) => colHeadBand(y, heads)
    // One totals row per direction that has cheques — "separately, when appropriate".
    const totals: [string, number][] = []
    if (d.pendingCheques.some((q) => q.direction === 'in')) totals.push(['Total from you', d.pendingIn])
    if (d.pendingCheques.some((q) => q.direction === 'out')) totals.push(['Total to you', d.pendingOut])
    d.pendingCheques.forEach((q, n) => {
      const num = wrap(q.number, false, F.body, w.num - 2 * PAD - 1)
      const bank = wrap(q.bank, false, F.body, w.bank - 2 * PAD - 1)
      const h = 2 * C.rowPad + Math.max(1, num.length, bank.length) * lineH(F.body)
      // The last cheque stays with the totals under it.
      sectionItems.push({ section: s, height: h, keepWithNext: n === d.pendingCheques.length - 1 })
      sectionDraw.push((y) => {
        const b = baseline(y + C.rowPad, F.body)
        font(false, F.body)
        put(q.directionLabel, x.dir, b)
        num.forEach((line, i) => put(line, x.num, b + i * lineH(F.body)))
        font(false, F.body)
        bank.forEach((line, i) => put(line, x.bank, b + i * lineH(F.body)))
        font(false, F.body)
        put(q.dueLabel, x.due, b)
        put(q.status, x.status, b)
        figure(money(q.amount), x.amt, b, figW(w.amt))
        rowRule(y + h)
      })
    })
    totals.forEach(([label, value], n) => {
      sectionItems.push({ section: s, height: C.row.totals, keepWithNext: n < totals.length - 1 })
      sectionDraw.push((y) => {
        if (n === 0) hrule(L, y, R, COLOR.ink, 0.3)
        const b = centred(y, C.row.totals, F.body)
        font(true, F.body)
        put(label, x.dir, b)
        figure(money(value), x.amt, b, figW(w.amt), true)
      })
    })
  }

  if (d.showCurrencySummary && d.currencySummary.length) {
    const s = sectionNo++
    // Quantities only: a PKR valuation of a customer's trades invites being read as a second balance.
    const w = { cur: 40, bought: 46, sold: 46 }
    const cx = { cur: L + PAD, bought: L + w.cur + w.bought - PAD, sold: L + w.cur + w.bought + w.sold - PAD, net: R - PAD }
    const netW = W - w.cur - w.bought - w.sold - 2 * PAD
    const heads = [
      { text: 'Currency', x: cx.cur },
      { text: 'Bought from you', x: cx.bought, right: true },
      { text: 'Sold to you', x: cx.sold, right: true },
      { text: 'Net', x: cx.net, right: true },
    ]
    const head = sectionHeading('Currency trading summary', 'For reference only; not added to your balance.', (y) => colHeadBand(y, heads))
    sectionItems.push({ section: s, height: head.h, keepWithNext: true })
    sectionDraw.push(head.draw)
    repeatHeights[s] = C.row.tableHead
    repeatDraw[s] = (y) => colHeadBand(y, heads)
    const rowH = 2 * C.rowPad + lineH(F.body) + lineH(F.secondary)
    d.currencySummary.forEach((c) => {
      sectionItems.push({ section: s, height: rowH })
      sectionDraw.push((y) => {
        const b1 = baseline(y + C.rowPad, F.body)
        const b2 = baseline(y + C.rowPad + lineH(F.body), F.secondary)
        font(true, F.body)
        put(c.code, cx.cur, b1)
        if (c.name) {
          font(false, F.secondary, COLOR.detail)
          put(c.name, cx.cur, b2)
        }
        if (c.bought) figure(c.boughtLabel, cx.bought, b1, figW(w.bought))
        else emptyCell(cx.bought - w.bought + PAD, w.bought, b1)
        if (c.sold) figure(c.soldLabel, cx.sold, b1, figW(w.sold))
        else emptyCell(cx.sold - w.sold + PAD, w.sold, b1)
        // The net: its quantity, and under it which way it went — never a bare quantity, which would read as a trade.
        if (c.netQuantity) figure(c.netQuantity, cx.net, b1, netW, true)
        figure(c.netDirection, cx.net, c.netQuantity ? b2 : b1, netW, false, c.netQuantity ? F.secondary : F.body, c.netQuantity ? COLOR.detail : COLOR.ink)
        rowRule(y + rowH)
      })
    })
  }

  // ------------------------------------------------------------------ lay out
  const firstTop = drawFirstHeader()
  const ledger = layoutLedger({
    items,
    firstTop,
    laterTop,
    bottom,
    tableHead: C.row.tableHead,
    continuity: C.row.continuity,
    keepWithClosing: C.keepWithClosing,
  })
  const sections = layoutSections({
    items: sectionItems,
    repeatHeights,
    startPage: ledger.endPage,
    startY: ledger.endY,
    laterTop,
    bottom,
    gap: 9,
  })
  const pages = Math.max(ledger.endPage, sectionItems.length ? sections.pages : 1)

  // Every page exists before anything is drawn on it, with its header (and table header where the ledger runs).
  drawTableHead(firstTop)
  for (let p = 2; p <= pages; p++) {
    doc.addPage()
    drawContinuationHeader()
    if (ledger.tablePages.includes(p)) drawTableHead(laterTop)
  }

  // ------------------------------------------------------------------ draw the ledger
  // Continuation rows: shaded, in the quieter detail colour, so they read as carried figures and not as entries.
  const continuityRow = (y: number, label: string, net: number) => {
    fill(L, y, W, C.row.continuity, COLOR.tint)
    const b = centred(y, C.row.continuity, F.body)
    font(false, F.body, COLOR.detail)
    put(label, col.part + PAD, b)
    balanceCell(net, b, false)
  }
  for (const c of ledger.brought) {
    doc.setPage(c.page)
    continuityRow(c.y, 'Balance brought forward', balanceAfter[c.afterItem])
  }
  for (const c of ledger.carried) {
    doc.setPage(c.page)
    continuityRow(c.y, 'Balance carried forward', balanceAfter[c.afterItem])
  }

  items.forEach((it, i) => {
    const at = ledger.items[i]
    doc.setPage(at.page)
    const y = at.y
    const b1 = baseline(y + C.rowPad, F.body)

    if (it.kind === 'opening') {
      if (d.periodFrom) {
        font(false, F.secondary)
        put(d.periodFrom, col.date + PAD, b1)
      }
      font(true, F.body)
      put(OPENING_LABEL, col.part + PAD, b1)
      balanceCell(d.opening, b1, true)
      rowRule(y + it.height)
      return
    }

    if (it.kind === 'entry') {
      const m = measured[i - 1]
      if (!m) {
        font(false, F.body, COLOR.detail)
        put(NO_ENTRIES_LABEL, col.part + PAD, b1)
        rowRule(y + it.height)
        return
      }
      const e = m.entry
      font(false, F.secondary)
      put(e.dateLabel, col.date + PAD, b1)
      let ly = y + C.rowPad
      for (const line of m.part) {
        font(false, F.body)
        put(line, col.part + PAD, baseline(ly, F.body))
        ly += lineH(F.body)
      }
      for (const line of m.detail) {
        font(false, F.secondary, COLOR.detail)
        put(line, col.part + PAD, baseline(ly, F.secondary))
        ly += lineH(F.secondary)
      }
      m.ref.forEach((line, n) => {
        font(false, F.reference, COLOR.light)
        put(line, col.ref + PAD, b1 + n * lineH(F.reference))
      })
      if (e.debit) figure(money(e.debit), col.debit + cw.debit - PAD, b1, figW(cw.debit))
      else emptyCell(col.debit, cw.debit, b1)
      if (e.credit) figure(money(e.credit), col.credit + cw.credit - PAD, b1, figW(cw.credit))
      else emptyCell(col.credit, cw.credit, b1)
      balanceCell(e.balance, b1, false)
      rowRule(y + it.height)
      return
    }

    if (it.kind === 'totals') {
      // Period totals: the two columns summed (zero prints as 0.00, not a dash). No balance on this row.
      hrule(L, y, R, COLOR.ink, 0.3)
      const b = centred(y, it.height, F.body)
      font(true, F.body)
      put('Period totals', col.part + PAD, b)
      figure(money(d.totalDebits), col.debit + cw.debit - PAD, b, figW(cw.debit), true)
      figure(money(d.totalCredits), col.credit + cw.credit - PAD, b, figW(cw.credit), true)
      return
    }

    // closing: compact — the figure and its Dr/Cr; the summary at the top already says it in words.
    fill(L, y, W, it.height, COLOR.tint)
    const b = centred(y, it.height, F.body)
    font(true, F.body)
    put('Closing balance', col.part + PAD, b)
    balanceCell(d.closing, b, true)
    hrule(L, y + it.height, R, COLOR.ink, 0.3)
  })

  // ------------------------------------------------------------------ draw the sections
  sectionItems.forEach((_, i) => {
    const at = sections.items[i]
    doc.setPage(at.page)
    sectionDraw[i](at.y)
  })
  for (const r of sections.repeats) {
    doc.setPage(r.page)
    repeatDraw[r.section](r.y)
  }

  // ------------------------------------------------------------------ footer on every page
  const footY = PH - 8.5
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    hrule(L, footY - 4, R, COLOR.rule, 0.2)
    font(false, F.footer, COLOR.light)
    put(`Page ${p} of ${pages}`, R, footY, 'right')
    put(`${d.business.name}  ·  ${d.title}  ·  Generated ${d.generatedAt}`, L, footY)
  }
  doc.setPage(1)
  return doc
}

/** The finished file, for the browser to open or save. */
export function statementPdfBlob(d: StatementDocument, opts?: RenderOptions): Blob {
  return renderStatementPdf(d, opts).output('blob')
}

/** The finished file's bytes, for Node (tests and the sample generator). */
export function statementPdfBytes(d: StatementDocument, opts?: RenderOptions): ArrayBuffer {
  return renderStatementPdf(d, opts).output('arraybuffer')
}
