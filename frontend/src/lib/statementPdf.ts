import { jsPDF } from 'jspdf'
import { COLOR, STATEMENT_CONFIG, type RGB, type StatementConfig } from './statementConfig'
import { layoutLedger, layoutSections, type LedgerItem, type SectionItem } from './statementLayout'
import { formatPaisa, splitBalance } from './statementMoney'
import { NO_ENTRIES_LABEL, OPENING_LABEL, type StatementDocument, type StatementEntry } from './statementDoc'
import { registerStatementFont, STATEMENT_FONT } from './statementFont'

// ---------------------------------------------------------------------------
// Draws a StatementDocument onto portrait A4, in the approved design
// ---------------------------------------------------------------------------
//
// Decides only WHERE things go and how they look. What the statement says — every figure, every word —
// was settled in statementDoc.ts, in plain data; the arithmetic of the page breaks is in statementLayout.ts;
// the palette and every dimension are in statementConfig.ts. This is the only file that touches jsPDF, and
// it is loaded lazily (the Print button `import()`s it), so the library never joins the main bundle.
//
// THE DESIGN follows the approved reference (a one-page sample; nothing of its data is used): business name
// in deep teal with the title and period opposite; the account holder; a deep-teal panel carrying the closing
// balance in words and figures with the opening balance beside it; "Account activity" — a table of Date |
// Transaction / Reference | Debit | Credit | Balance with each reference on the line beneath its description,
// alternate rows shaded, an em dash in an unused Debit or Credit cell; period totals; a shaded closing row;
// the Dr/Cr legend; and a footer with the generated time and "Page X of Y".
//
// LONGER STATEMENTS CONTINUE NATURALLY: every later page repeats the customer's identification and the
// table heads, and the running balance is carried and brought forward at each break. Text is never shrunk to
// save pages; descriptions wrap, and a figure is set smaller only if it would otherwise not fit its column.

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
/** Cap height of Inter, as a fraction of the type size — used to centre a line's capitals in its line box. */
const CAP_HEIGHT = 0.727
/** The least space kept between a right-aligned figure and the column to its left. */
const GUTTER = 0.5
/** An unused Debit or Credit cell, as in the design. */
const EMPTY_CELL = '—'

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
  // The Date column fits the longest date printed; whatever it needs beyond its minimum comes out of the
  // description, never the amounts.
  const dateLabels = [d.openingDateLabel, d.closingDateLabel, ...d.entries.map((e) => e.dateLabel)]
  doc.setFont(STATEMENT_FONT, 'bold')
  doc.setFontSize(C.font.body)
  const dateNeed = Math.max(0, ...dateLabels.map((t) => doc.getTextWidth(t))) + 2 * C.cellPad
  const dateW = Math.max(C.columns.date, dateNeed)
  const cw = { ...C.columns, date: dateW, particulars: C.columns.particulars - (dateW - C.columns.date) }
  const col = {
    date: L,
    part: L + cw.date,
    debit: L + cw.date + cw.particulars,
    credit: L + cw.date + cw.particulars + cw.debit,
    bal: L + cw.date + cw.particulars + cw.debit + cw.credit,
  }
  const right = {
    debit: col.debit + cw.debit - PAD,
    credit: col.credit + cw.credit - PAD,
    bal: col.bal + cw.balance - PAD,
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
  /** Draws text and records it in the trace. `x` is the anchor for the alignment given. `track` is letter spacing, mm. */
  const put = (text: string, x: number, y: number, align: 'left' | 'right' = 'left', track = 0) => {
    if (!text) return
    const width = doc.getTextWidth(text) + (track ? track * (text.length - 1) : 0)
    const left = align === 'right' ? x - width : x
    doc.text(text, left, y, track ? { charSpace: track } : undefined)
    opts.trace?.push({ page: doc.getCurrentPageInfo().pageNumber, text, x: left, y, width, size: curSize, bold: curBold })
  }
  /** A small upper-case label, lightly tracked, as the design sets them. */
  const label = (text: string, x: number, y: number, color: RGB = COLOR.light, align: 'left' | 'right' = 'left') => {
    font(true, F.label, color)
    put(text.toUpperCase(), x, y, align, C.labelTracking)
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
  /** Word-wraps `text` to `maxW`; a single word too long for the line is broken, never cut. */
  const wrap = (text: string, bold: boolean, size: number, maxW: number): string[] => {
    if (!text) return []
    font(bold, size)
    return doc.splitTextToSize(text, maxW) as string[]
  }
  /** The size, at most `size`, at which `text` fits `maxW`. Only figures use it: an amount stays on one line. */
  const fitSize = (text: string, bold: boolean, size: number, maxW: number): number => {
    let s = size
    font(bold, s)
    while (s > C.minFigureSize && doc.getTextWidth(text) > maxW) {
      s = Math.max(C.minFigureSize, s - 0.25)
      font(bold, s)
    }
    return s
  }
  const figure = (text: string, rightEdge: number, y: number, maxW: number, bold = false, size: number = F.body, color: RGB = COLOR.ink) => {
    const s = fitSize(text, bold, size, maxW)
    font(bold, s, color)
    put(text, rightEdge, y, 'right')
  }
  /** Width held after a balance's digits for " Dr" / " Cr", so the digits align with or without one. */
  font(false, F.body)
  const SIDE_SLOT = doc.getTextWidth(' Dr') + 1
  /** A ledger balance: digits right-aligned to a fixed edge, then "Dr"/"Cr" in its own slot, lighter. */
  const balanceCell = (net: number, y: number, bold: boolean, color: RGB = COLOR.ink) => {
    const { amount, side } = splitBalance(net, dec)
    figure(amount, right.bal - SIDE_SLOT, y, figW(cw.balance) - SIDE_SLOT, bold, F.body, color)
    if (side) {
      font(bold, F.body, COLOR.light)
      put(side, right.bal, y, 'right')
    }
  }
  const emptyCell = (rightEdge: number, y: number) => {
    font(false, F.body, COLOR.light)
    put(EMPTY_CELL, rightEdge, y, 'right')
  }
  const rowRule = (y: number) => hrule(L, y, R, COLOR.rule, 0.2)

  // ------------------------------------------------------------------ page 1: header, account holder, panel
  function drawFirstHeader(): number {
    const top = C.margin.top
    // Business (left) and the document (right).
    const nameLines = wrap(d.business.name, true, F.business, W * 0.5)
    let ly = top
    nameLines.forEach((line) => {
      font(true, F.business, COLOR.brand)
      put(line, L, baseline(ly, F.business))
      ly += lineH(F.business)
    })
    for (const line of [d.business.tagline, d.business.contactLine].filter(Boolean)) {
      font(false, F.tagline, COLOR.detail)
      put(line, L, baseline(ly, F.tagline))
      ly += lineH(F.tagline)
    }
    font(true, F.title, COLOR.ink)
    put(d.title, R, baseline(top, F.business), 'right')
    font(false, F.period, COLOR.detail)
    put(d.periodTitle, R, baseline(top + lineH(F.business) + 1.2, F.tagline), 'right')
    let y = Math.max(ly, top + lineH(F.business) + 1.2 + lineH(F.tagline)) + 4
    hrule(L, y, R, COLOR.rule, 0.3)
    y += 6

    // The account holder.
    label('Account holder', L, baseline(y, F.label))
    y += lineH(F.label) + 0.8
    for (const line of wrap(d.customerName, true, F.customer, W * 0.62)) {
      font(true, F.customer, COLOR.ink)
      put(line, L, baseline(y, F.customer))
      y += lineH(F.customer)
    }
    font(false, F.account, COLOR.detail)
    put(`Account ${d.accountRef}`, L, baseline(y + 0.4, F.account))
    y += lineH(F.account) + 6

    // The closing balance, in words and figures, on the deep-teal panel; the opening balance beside it.
    const P = C.panel
    const pt = y
    const c = tone(COLOR.brand)
    doc.setFillColor(c[0], c[1], c[2])
    doc.roundedRect(L, pt, W, P.height, P.radius, P.radius, 'F')
    label(`Closing balance · ${d.asAtLabel}`, L + P.pad, pt + P.pad + 2.6, COLOR.onBrandMuted)
    const by = pt + P.height - P.pad - 1
    font(false, F.panelDirection, COLOR.onBrand)
    put(d.closingLabel, L + P.pad, by)
    let x = L + P.pad + doc.getTextWidth(d.closingLabel) + 5
    font(false, F.panelCurrency, COLOR.onBrandMuted)
    put(cur, x, by)
    x += doc.getTextWidth(cur) + 3
    const amount = splitBalance(d.closing, dec).amount
    const openingText = `${cur} ${splitBalance(d.opening, dec).amount}${splitBalance(d.opening, dec).side ? ` ${splitBalance(d.opening, dec).side}` : ''}`
    font(true, F.panelOpeningValue)
    const openingW = Math.max(doc.getTextWidth(openingText), 30)
    const s = fitSize(amount, true, F.balance, R - P.pad - openingW - 8 - x)
    font(true, s, COLOR.onBrand)
    put(amount, x, by)
    font(false, F.panelOpeningLabel, COLOR.onBrandMuted)
    put('Opening balance', R - P.pad, by - lineH(F.panelOpeningValue) - 0.6, 'right')
    font(true, F.panelOpeningValue, COLOR.onBrand)
    put(openingText, R - P.pad, by, 'right')
    y = pt + P.height + 10

    // "Account activity", with the currency stated once.
    font(true, F.section, COLOR.ink)
    put('Account activity', L, y)
    font(false, F.note, COLOR.detail)
    put(`All amounts in ${cur}`, R, y, 'right')
    return y + 4.5
  }

  // Later pages: who, which account, which period — so a loose page is still identifiable.
  const contTop = C.margin.top - 2
  const contName = wrap(d.customerName, true, F.body + 0.5, W * 0.62)
  function drawContinuationHeader(): void {
    contName.forEach((line, i) => {
      font(true, F.body + 0.5, COLOR.ink)
      put(line, L, baseline(contTop + i * lineH(F.body + 0.5), F.body + 0.5))
    })
    font(true, F.body + 0.5, COLOR.brand)
    put(d.business.name, R, baseline(contTop, F.body + 0.5), 'right')
    const y2 = contTop + contName.length * lineH(F.body + 0.5)
    font(false, F.note, COLOR.detail)
    put(`Account ${d.accountRef}  ·  ${d.periodTitle}`, L, baseline(y2, F.note))
    put(`${d.title}  ·  amounts in ${cur}`, R, baseline(y2, F.note), 'right')
    hrule(L, y2 + lineH(F.note) + 1.5, R, COLOR.rule, 0.3)
  }
  const laterTop = contTop + contName.length * lineH(F.body + 0.5) + lineH(F.note) + 5.5

  function drawTableHead(y: number): void {
    const h = C.row.tableHead
    fill(L, y, W, h, COLOR.tint)
    const ty = centred(y, h, F.tableHead)
    font(true, F.tableHead, COLOR.ink)
    put('Date', col.date + PAD, ty)
    put('Transaction / Reference', col.part + PAD, ty)
    put('Debit', right.debit, ty, 'right')
    put('Credit', right.credit, ty, 'right')
    put('Balance', right.bal, ty, 'right')
    hrule(L, y + h, R, COLOR.rule, 0.3)
  }

  // ------------------------------------------------------------------ measure the ledger rows
  // Descriptions stop a clear gap short of the Debit column, so text and figures never read as one.
  const partW = cw.particulars - PAD - C.particularsGap
  interface MeasuredEntry {
    entry: StatementEntry
    part: string[]
    second: string[]
    height: number
  }
  const measure = (e: StatementEntry): MeasuredEntry => {
    const part = wrap(e.particulars, false, F.body, partW)
    // The reference sits beneath the description, then whatever else identifies the entry.
    const second = wrap([e.reference, e.detail].filter(Boolean).join(' · '), false, F.secondary, partW)
    const textH = part.length * lineH(F.body) + second.length * (lineH(F.secondary) + 0.3)
    return { entry: e, part, second, height: Math.max(textH, lineH(F.body)) + 2 * C.rowPad }
  }
  const measured = d.entries.map(measure)
  const singleRow = lineH(F.body) + 2 * C.rowPad
  const LEGEND_H = 8

  // items: opening, entries (or one "no transactions" row), totals, closing (+ the legend under it).
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
  items.push({ kind: 'closing', height: C.row.closing + LEGEND_H })
  balanceAfter.push(d.closing)

  // ------------------------------------------------------------------ measure the sections
  const sectionItems: SectionItem[] = []
  const sectionDraw: ((y: number) => void)[] = []
  const repeatHeights: number[] = []
  const repeatDraw: ((y: number) => void)[] = []
  const bottom = PH - C.margin.bottom

  /** A section's title (with its one short note opposite) and column heads — kept with the first row. */
  const sectionHeading = (title: string, note: string, colHead: (y: number) => void) => {
    const h = C.row.sectionHead + C.row.tableHead
    const draw = (y: number) => {
      font(true, F.section, COLOR.ink)
      put(title, L, y + C.row.sectionHead - 4.5)
      font(false, F.note, COLOR.detail)
      put(note, R, y + C.row.sectionHead - 4.5, 'right')
      colHead(y + C.row.sectionHead)
    }
    return { h, draw }
  }
  const colHeadBand = (y: number, cells: { text: string; x: number; right?: boolean }[]) => {
    const h = C.row.tableHead
    fill(L, y, W, h, COLOR.tint)
    const ty = centred(y, h, F.tableHead)
    font(true, F.tableHead, COLOR.ink)
    for (const c of cells) put(c.text, c.x, ty, c.right ? 'right' : 'left')
    hrule(L, y + h, R, COLOR.rule, 0.3)
  }

  let sectionNo = 0
  if (d.pendingCheques.length) {
    const s = sectionNo++
    const w = { dir: 34, num: 32, bank: 40, due: 28, status: 24, amt: 26 }
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
    const totals: [string, number][] = []
    if (d.pendingCheques.some((q) => q.direction === 'in')) totals.push(['Total from you', d.pendingIn])
    if (d.pendingCheques.some((q) => q.direction === 'out')) totals.push(['Total to you', d.pendingOut])
    d.pendingCheques.forEach((q, n) => {
      const num = wrap(q.number, false, F.body, w.num - 2 * PAD)
      const bank = wrap(q.bank, false, F.body, w.bank - 2 * PAD)
      const h = 2 * (C.rowPad - 1) + Math.max(1, num.length, bank.length) * lineH(F.body)
      sectionItems.push({ section: s, height: h, keepWithNext: n === d.pendingCheques.length - 1 })
      sectionDraw.push((y) => {
        if (n % 2 === 0) fill(L, y, W, h, COLOR.zebra)
        const b = baseline(y + C.rowPad - 1, F.body)
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
    totals.forEach(([text, value], n) => {
      sectionItems.push({ section: s, height: C.row.totals - 2, keepWithNext: n < totals.length - 1 })
      sectionDraw.push((y) => {
        const b = centred(y, C.row.totals - 2, F.body)
        font(true, F.body)
        put(text, x.dir, b)
        figure(money(value), x.amt, b, figW(w.amt), true)
        rowRule(y + C.row.totals - 2)
      })
    })
  }

  if (d.showCurrencySummary && d.currencySummary.length) {
    const s = sectionNo++
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
    d.currencySummary.forEach((c, n) => {
      sectionItems.push({ section: s, height: rowH })
      sectionDraw.push((y) => {
        if (n % 2 === 0) fill(L, y, W, rowH, COLOR.zebra)
        const b1 = baseline(y + C.rowPad, F.body)
        const b2 = baseline(y + C.rowPad + lineH(F.body), F.secondary)
        font(true, F.body)
        put(c.code, cx.cur, b1)
        if (c.name) {
          font(false, F.secondary, COLOR.detail)
          put(c.name, cx.cur, b2)
        }
        if (c.bought) figure(c.boughtLabel, cx.bought, b1, figW(w.bought))
        else emptyCell(cx.bought, b1)
        if (c.sold) figure(c.soldLabel, cx.sold, b1, figW(w.sold))
        else emptyCell(cx.sold, b1)
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
    keepWithClosingHeight: C.keepWithClosingHeight,
  })
  const sections = layoutSections({
    items: sectionItems,
    repeatHeights,
    startPage: ledger.endPage,
    startY: ledger.endY,
    laterTop,
    bottom,
    gap: 10,
  })
  const pages = Math.max(ledger.endPage, sectionItems.length ? sections.pages : 1)

  drawTableHead(firstTop)
  for (let p = 2; p <= pages; p++) {
    doc.addPage()
    drawContinuationHeader()
    if (ledger.tablePages.includes(p)) drawTableHead(laterTop)
  }

  // ------------------------------------------------------------------ draw the ledger
  // Continuation rows: lightly shaded, in the quieter grey, so they read as carried figures and not as entries.
  const continuityRow = (y: number, text: string, net: number) => {
    fill(L, y, W, C.row.continuity, COLOR.zebra)
    const b = centred(y, C.row.continuity, F.body)
    font(false, F.body, COLOR.detail)
    put(text, col.part + PAD, b)
    balanceCell(net, b, false, COLOR.detail)
    rowRule(y + C.row.continuity)
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
      font(true, F.body)
      put(d.openingDateLabel, col.date + PAD, b1)
      put(OPENING_LABEL, col.part + PAD, b1)
      emptyCell(right.debit, b1)
      emptyCell(right.credit, b1)
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
      // Alternate transactions shaded, starting with the first, as in the design.
      if ((i - 1) % 2 === 0) fill(L, y, W, it.height, COLOR.zebra)
      const e = m.entry
      font(false, F.body)
      put(e.dateLabel, col.date + PAD, b1)
      let ly = y + C.rowPad
      for (const line of m.part) {
        font(false, F.body)
        put(line, col.part + PAD, baseline(ly, F.body))
        ly += lineH(F.body)
      }
      ly += 0.3
      for (const line of m.second) {
        font(false, F.secondary, COLOR.detail)
        put(line, col.part + PAD, baseline(ly, F.secondary))
        ly += lineH(F.secondary) + 0.3
      }
      if (e.debit) figure(money(e.debit), right.debit, b1, figW(cw.debit))
      else emptyCell(right.debit, b1)
      if (e.credit) figure(money(e.credit), right.credit, b1, figW(cw.credit))
      else emptyCell(right.credit, b1)
      balanceCell(e.balance, b1, false)
      rowRule(y + it.height)
      return
    }

    if (it.kind === 'totals') {
      // Period totals: the two columns summed (zero prints as 0.00, not a dash). No balance on this row.
      const b = centred(y, it.height, F.body)
      font(true, F.body)
      put('Period totals', col.part + PAD, b)
      figure(money(d.totalDebits), right.debit, b, figW(cw.debit), true)
      figure(money(d.totalCredits), right.credit, b, figW(cw.credit), true)
      rowRule(y + it.height)
      return
    }

    // closing: shaded, in the teal, the figure and its side; then the legend, once, under the table.
    const h = C.row.closing
    fill(L, y, W, h, COLOR.tint)
    const b = centred(y, h, F.body)
    font(true, F.body, COLOR.brand)
    put(d.closingDateLabel, col.date + PAD, b)
    put('Closing balance', col.part + PAD, b)
    balanceCell(d.closing, b, true, COLOR.brand)
    font(false, F.note, COLOR.detail)
    put('Dr = you owe us  ·  Cr = we owe you', L, y + h + 6)
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
  const footY = PH - 9
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    hrule(L, footY - 4.5, R, COLOR.rule, 0.3)
    font(false, F.footer, COLOR.light)
    const rightText = `Generated ${d.generatedAt}  ·  Page ${p} of ${pages}`
    put(rightText, R, footY, 'right')
    // The business and the customer; a name too long to fit is left out rather than cut (the header names it).
    const maxW = W - doc.getTextWidth(rightText) - 8
    const full = `${d.business.name}  ·  ${d.customerName}  ·  Account ${d.accountRef}`
    put(doc.getTextWidth(full) <= maxW ? full : `${d.business.name}  ·  Account ${d.accountRef}`, L, footY)
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
