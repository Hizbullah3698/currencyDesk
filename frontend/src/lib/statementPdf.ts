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
// THE LOOK is a plain bank statement: dark ink on white, navy only for headings and the closing figure,
// a faint shade for the summary and the continuity rows, and hairlines between rows. Colour never carries
// meaning — every balance writes its side — so a black-and-white copy loses nothing (`grayscale: true`
// renders exactly that, for checking).
//
// TEXT NEVER CLIPS. Descriptive text wraps onto further lines and the row grows; a figure too wide for its
// column is set slightly smaller (never cut), down to `minFigureSize`. Rows are measured before layout, so
// the page breaks know each row's real height.

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
const SIDE_SLOT = 6
/** The least space kept between a right-aligned figure and the column to its left. */
const GUTTER = 0.5

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
    voucher: L + cw.date + cw.particulars,
    debit: L + cw.date + cw.particulars + cw.voucher,
    credit: L + cw.date + cw.particulars + cw.voucher + cw.debit,
    bal: L + cw.date + cw.particulars + cw.voucher + cw.debit + cw.credit,
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
  const vrule = (x: number, y1: number, y2: number, color: RGB, width: number) => {
    const c = tone(color)
    doc.setDrawColor(c[0], c[1], c[2])
    doc.setLineWidth(width)
    doc.line(x, y1, x, y2)
  }
  const fill = (x: number, y: number, w: number, h: number, color: RGB) => {
    const c = tone(color)
    doc.setFillColor(c[0], c[1], c[2])
    doc.rect(x, y, w, h, 'F')
  }
  const lineH = (size: number) => size * MM_PER_PT * C.leading
  /** Baseline of a line of `size` pt whose line box starts at `top`: its capitals centred in the box. */
  const baseline = (top: number, size: number) => top + lineH(size) / 2 + (size * MM_PER_PT * CAP_HEIGHT) / 2
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
  /** A balance: digits right-aligned to a fixed edge, "Dr"/"Cr" in a fixed slot beyond it. */
  const balanceCell = (net: number, y: number, bold: boolean, size: number = F.body) => {
    const { amount, side } = splitBalance(net, dec)
    const right = col.bal + cw.balance - PAD
    figure(amount, right - SIDE_SLOT, y, figW(cw.balance) - SIDE_SLOT, bold, size)
    if (side) {
      font(bold, F.side, COLOR.detail)
      put(side, right, y, 'right')
    }
  }

  // ------------------------------------------------------------------ page 1 header
  function drawFirstHeader(): number {
    let y = C.margin.top
    // Business (left) and the document's title (right), sharing the top line.
    const nameLines = wrap(d.business.name, true, F.title, W * 0.55)
    font(true, F.title, COLOR.brand)
    nameLines.forEach((line, i) => put(line, L, baseline(y + i * lineH(F.title), F.title)))
    font(true, F.title, COLOR.ink)
    put(d.title, R, baseline(y, F.title), 'right')
    y += Math.max(1, nameLines.length) * lineH(F.title)
    // Address and phone only when they exist — nothing is invented to fill the space.
    const contact = [...d.business.addressLines, ...(d.business.phone ? [`Tel. ${d.business.phone}`] : [])]
    for (const text of contact) {
      for (const line of wrap(text, false, F.note, W * 0.6)) {
        font(false, F.note, COLOR.light)
        put(line, L, baseline(y, F.note))
        y += lineH(F.note)
      }
    }
    y += 1.6
    hrule(L, y, R, COLOR.brand, 0.5)
    y += 3.4

    // The facts, each labelled. Customer and account on the left; period, currency, time on the right.
    const half = (W - 8) / 2
    const labelW = 29
    const facts = (x: number, top: number, rows: [string, string, boolean][]): number => {
      let fy = top
      for (const [label, value, strong] of rows) {
        const size = strong ? F.value - 0.5 : F.body
        const lines = wrap(value, strong, size, half - labelW)
        font(false, F.label, COLOR.light)
        put(label, x, baseline(fy, size))
        font(strong, size, COLOR.ink)
        lines.forEach((line, i) => put(line, x + labelW, baseline(fy + i * lineH(size), size)))
        fy += Math.max(1, lines.length) * lineH(size) + 0.6
      }
      return fy
    }
    const leftEnd = facts(L, y, [
      ['Customer', d.customerName, true],
      ['Account ID', d.accountId, false],
    ])
    const rightEnd = facts(L + half + 8, y, [
      ['Statement period', d.periodLabel, false],
      ['Account currency', `${cur} (${d.accountCurrency.name})`, false],
      ['Generated', d.generatedAt, false],
    ])
    y = Math.max(leftEnd, rightEnd) + 2.4

    // The summary. Closing balance is the widest cell, the largest figure, and says what it means.
    const top = y
    const h = 22
    fill(L, top, W, h, COLOR.tint)
    const cells = [36, 36, 36, W - 108]
    const labels = [`Opening balance (${cur})`, `Total debits (${cur})`, `Total credits (${cur})`, `Closing balance (${cur})`]
    let x = L
    cells.forEach((w, i) => {
      if (i > 0) vrule(x, top + 3, top + h - 3, i === 3 ? COLOR.brand : COLOR.rule, i === 3 ? 0.6 : 0.2)
      const cx = x + 3.5
      font(false, F.label, COLOR.light)
      put(labels[i], cx, top + 6)
      if (i < 3) {
        if (i === 0) {
          const { amount, side } = splitBalance(d.opening, dec)
          const s = fitSize(amount, true, F.value, w - 7 - (side ? 5 : 0))
          font(true, s)
          put(amount, cx, top + 13.6)
          if (side) {
            const end = cx + doc.getTextWidth(amount)
            font(false, F.side, COLOR.detail)
            put(side, end + 1.2, top + 13.6)
          }
        } else {
          const v = money(i === 1 ? d.totalDebits : d.totalCredits)
          const s = fitSize(v, true, F.value, w - 7)
          font(true, s)
          put(v, cx, top + 13.6)
        }
      } else {
        const { amount, side } = splitBalance(d.closing, dec)
        const s = fitSize(amount, true, F.closingValue, w - 7 - 8)
        font(true, s, COLOR.brand)
        put(amount, cx, top + 13.6)
        if (side) {
          const end = cx + doc.getTextWidth(amount)
          font(true, F.body, COLOR.brand)
          put(side, end + 1.4, top + 13.6)
        }
        const ms = fitSize(d.closingMeaning, true, F.detail, w - 7)
        font(true, ms, COLOR.ink)
        put(d.closingMeaning, cx, top + 19)
      }
      x += w
    })
    y = top + h + 1.2

    // What Dr and Cr mean, stated once, where the reader first meets them.
    const legend = `All amounts are in ${cur} (${d.accountCurrency.name}). Dr: the customer owes the business. Cr: the business owes the customer.`
    for (const line of wrap(legend, false, F.note, W)) {
      font(false, F.note, COLOR.light)
      put(line, L, baseline(y, F.note))
      y += lineH(F.note)
    }
    return y + 2.6
  }

  /** Later pages: a compact header naming the customer, the account and the period. */
  // A long name wraps here as everywhere else — never shrunk or cut — and the header grows to fit it.
  const contTop = C.margin.top - 2
  const contName = wrap(d.customerName, true, F.body, W * 0.62)
  function drawContinuationHeader(): void {
    contName.forEach((line, i) => {
      font(true, F.body, COLOR.ink)
      put(line, L, baseline(contTop + i * lineH(F.body), F.body))
    })
    font(false, F.label, COLOR.light)
    put(`${d.title} · ${d.business.name}`, R, baseline(contTop, F.body), 'right')
    const y2 = contTop + contName.length * lineH(F.body)
    put(`Account ID ${d.accountId} · ${d.periodLabel}`, L, baseline(y2, F.label))
    put(`Amounts in ${cur}`, R, baseline(y2, F.label), 'right')
    hrule(L, y2 + lineH(F.label) + 1, R, COLOR.brand, 0.35)
  }
  const laterTop = contTop + contName.length * lineH(F.body) + lineH(F.label) + 4.2

  function drawTableHead(y: number): void {
    const h = C.row.tableHead
    fill(L, y, W, h, COLOR.tint)
    const ty = y + h / 2 + (F.tableHead * MM_PER_PT * CAP_HEIGHT) / 2
    font(true, F.tableHead, COLOR.ink)
    put('Date', col.date + PAD, ty)
    put('Particulars', col.part + PAD, ty)
    put('Voucher No.', col.voucher + PAD, ty)
    put(`Debit (${cur})`, col.debit + cw.debit - PAD, ty, 'right')
    put(`Credit (${cur})`, col.credit + cw.credit - PAD, ty, 'right')
    put(`Balance (${cur})`, col.bal + cw.balance - PAD, ty, 'right')
    hrule(L, y + h, R, COLOR.brand, 0.35)
  }

  // ------------------------------------------------------------------ measure the ledger rows
  const partW = cw.particulars - 2 * PAD
  interface MeasuredEntry {
    entry: StatementEntry
    part: string[]
    detail: string[]
    voucher: string[]
    height: number
  }
  const measure = (e: StatementEntry): MeasuredEntry => {
    const part = wrap(e.particulars, false, F.body, partW)
    const detail = wrap(e.detail, false, F.detail, partW)
    const voucher = wrap(e.voucher, false, F.voucher, cw.voucher - 2 * PAD)
    const textH = Math.max(part.length * lineH(F.body) + detail.length * lineH(F.detail), voucher.length * lineH(F.voucher), lineH(F.body))
    return { entry: e, part, detail, voucher, height: textH + 2 * C.rowPad }
  }
  const measured = d.entries.map(measure)
  const singleRow = lineH(F.body) + 2 * C.rowPad
  const closingLines = wrap(d.closingMeaning, true, F.detail, cw.particulars + cw.voucher - 2 * PAD)
  const closingH = 2 * C.rowPad + lineH(F.body) + closingLines.length * lineH(F.detail)

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
  items.push({ kind: 'closing', height: closingH })
  balanceAfter.push(d.closing)

  // ------------------------------------------------------------------ measure the sections
  const sectionItems: SectionItem[] = []
  const sectionDraw: ((y: number) => void)[] = []
  const repeatHeights: number[] = []
  const repeatDraw: ((y: number) => void)[] = []
  const bottom = PH - C.margin.bottom

  const sectionHeading = (title: string, note: string, colHead: (y: number) => void) => {
    const noteLines = wrap(note, false, F.note, W)
    const h = C.row.sectionHead + noteLines.length * lineH(F.note) + 1.4 + C.row.tableHead
    const draw = (y: number) => {
      font(true, F.section, COLOR.brand)
      put(title, L, y + C.row.sectionHead - 2)
      let ny = y + C.row.sectionHead
      for (const line of noteLines) {
        font(false, F.note, COLOR.light)
        put(line, L, baseline(ny, F.note))
        ny += lineH(F.note)
      }
      colHead(ny + 1.4)
    }
    return { h, draw }
  }
  const colHeadBand = (y: number, cells: { text: string; x: number; right?: boolean }[]) => {
    const h = C.row.tableHead
    fill(L, y, W, h, COLOR.tint)
    const ty = y + h / 2 + (F.tableHead * MM_PER_PT * CAP_HEIGHT) / 2
    font(true, F.tableHead, COLOR.ink)
    for (const c of cells) put(c.text, c.x, ty, c.right ? 'right' : 'left')
    hrule(L, y + h, R, COLOR.brand, 0.35)
  }
  const rowRule = (y: number) => hrule(L, y, R, COLOR.rule, 0.15)

  let sectionNo = 0
  if (d.currencySummary.length) {
    const s = sectionNo++
    const w = { cur: 40, bought: 48, sold: 48 }
    const cx = { cur: L + PAD, bought: L + w.cur + w.bought - PAD, sold: L + w.cur + w.bought + w.sold - PAD, net: R - PAD }
    const netW = W - w.cur - w.bought - w.sold - 2 * PAD
    const heads = [
      { text: 'Currency', x: cx.cur },
      { text: 'Bought from customer', x: cx.bought, right: true },
      { text: 'Sold to customer', x: cx.sold, right: true },
      { text: 'Net bought / net sold', x: cx.net, right: true },
    ]
    const head = sectionHeading(
      'Currency Trading Summary',
      `Trading summary only. These figures are not an additional amount payable. Quantities are per currency and never added across currencies. ${cur} figures are the value of those deals at each deal's own rate, not profit and not today's value.`,
      (y) => colHeadBand(y, heads),
    )
    sectionItems.push({ section: s, height: head.h, keepWithNext: true })
    sectionDraw.push(head.draw)
    repeatHeights[s] = C.row.tableHead
    repeatDraw[s] = (y) => colHeadBand(y, heads)
    const rowH = 2 * C.rowPad + lineH(F.body) + lineH(F.detail)
    d.currencySummary.forEach((c) => {
      sectionItems.push({ section: s, height: rowH })
      sectionDraw.push((y) => {
        const b1 = baseline(y + C.rowPad, F.body)
        const b2 = baseline(y + C.rowPad + lineH(F.body), F.detail)
        font(true, F.body)
        put(c.code, cx.cur, b1)
        if (c.name) {
          font(false, F.detail, COLOR.detail)
          put(c.name, cx.cur, b2)
        }
        const qty = (label: string, units: number, value: number, right: number, maxW: number) => {
          if (!units) {
            font(false, F.body, COLOR.light)
            put('-', right, b1, 'right')
            return
          }
          figure(label, right, b1, maxW)
          figure(`${cur} ${money(value)}`, right, b2, maxW, false, F.detail, COLOR.detail)
        }
        qty(c.boughtLabel, c.bought, c.boughtValue, cx.bought, figW(w.bought))
        qty(c.soldLabel, c.sold, c.soldValue, cx.sold, figW(w.sold))
        // The net: its quantity, and on the line under it which way it went. Never just a bare quantity,
        // which would read as a sale or purchase of that amount.
        if (c.netQuantity) figure(c.netQuantity, cx.net, b1, netW, true)
        figure(c.netDirection, cx.net, c.netQuantity ? b2 : b1, netW, !c.netQuantity, c.netQuantity ? F.detail : F.body, c.netQuantity ? COLOR.detail : COLOR.ink)
        rowRule(y + rowH)
      })
    })
  }

  if (d.pendingCheques.length) {
    const s = sectionNo++
    const w = { dir: 44, num: 30, bank: 40, due: 24, status: 22, amt: 26 }
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
      { text: 'Due Date', x: x.due },
      { text: 'Status', x: x.status },
      { text: `Amount (${cur})`, x: x.amt, right: true },
    ]
    const head = sectionHeading(
      'Uncleared Cheques',
      `These cheques are not included in the account balance until cleared. Status as at ${d.generatedAt}.`,
      (y) => colHeadBand(y, heads),
    )
    sectionItems.push({ section: s, height: head.h, keepWithNext: true })
    sectionDraw.push(head.draw)
    repeatHeights[s] = C.row.tableHead
    repeatDraw[s] = (y) => colHeadBand(y, heads)
    d.pendingCheques.forEach((q, n) => {
      const num = wrap(q.number, false, F.body, w.num - 2 * PAD)
      const bank = wrap(q.bank, false, F.body, w.bank - 2 * PAD)
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
    const totals: [string, number][] = [
      ['Total received from customer (uncleared)', d.pendingIn],
      ['Total issued to customer (uncleared)', d.pendingOut],
    ]
    totals.forEach(([label, value], n) => {
      sectionItems.push({ section: s, height: C.row.totals, keepWithNext: n === 0 })
      sectionDraw.push((y) => {
        if (n === 0) hrule(L, y, R, COLOR.ink, 0.3)
        const b = baseline(y + (C.row.totals - lineH(F.body)) / 2, F.body)
        font(true, F.body)
        put(label, x.dir, b)
        figure(money(value), x.amt, b, figW(w.amt), true)
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
    gap: 8,
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
  const continuityRow = (y: number, label: string, net: number) => {
    fill(L, y, W, C.row.continuity, COLOR.tint)
    const b = baseline(y + (C.row.continuity - lineH(F.body)) / 2, F.body)
    font(true, F.body)
    put(label, col.part + PAD, b)
    balanceCell(net, b, true)
  }
  for (const c of ledger.brought) {
    doc.setPage(c.page)
    continuityRow(c.y, 'Balance brought forward', balanceAfter[c.afterItem])
  }
  for (const c of ledger.carried) {
    doc.setPage(c.page)
    hrule(L, c.y, R, COLOR.ink, 0.3)
    continuityRow(c.y, 'Balance carried forward', balanceAfter[c.afterItem])
  }

  items.forEach((it, i) => {
    const at = ledger.items[i]
    doc.setPage(at.page)
    const y = at.y
    const b1 = baseline(y + C.rowPad, F.body)

    if (it.kind === 'opening') {
      fill(L, y, W, it.height, COLOR.tint)
      if (d.periodFrom) {
        font(false, F.date)
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
      font(false, F.date)
      put(e.dateLabel, col.date + PAD, b1)
      let ly = y + C.rowPad
      for (const line of m.part) {
        font(false, F.body)
        put(line, col.part + PAD, baseline(ly, F.body))
        ly += lineH(F.body)
      }
      for (const line of m.detail) {
        font(false, F.detail, COLOR.detail)
        put(line, col.part + PAD, baseline(ly, F.detail))
        ly += lineH(F.detail)
      }
      m.voucher.forEach((line, n) => {
        font(false, F.voucher, COLOR.light)
        put(line, col.voucher + PAD, b1 + n * lineH(F.voucher))
      })
      if (e.debit) figure(money(e.debit), col.debit + cw.debit - PAD, b1, figW(cw.debit))
      if (e.credit) figure(money(e.credit), col.credit + cw.credit - PAD, b1, figW(cw.credit))
      balanceCell(e.balance, b1, false)
      rowRule(y + it.height)
      return
    }

    if (it.kind === 'totals') {
      // Period totals: the two columns summed. No balance on this row — the closing balance is its own row.
      hrule(L, y, R, COLOR.ink, 0.3)
      const b = baseline(y + (it.height - lineH(F.body)) / 2, F.body)
      font(true, F.body)
      put('Period totals', col.part + PAD, b)
      figure(money(d.totalDebits), col.debit + cw.debit - PAD, b, figW(cw.debit), true)
      figure(money(d.totalCredits), col.credit + cw.credit - PAD, b, figW(cw.credit), true)
      return
    }

    // closing: its own row, with what it means under the label.
    fill(L, y, W, it.height, COLOR.tint)
    hrule(L, y, R, COLOR.brand, 0.5)
    font(true, F.body)
    put('Closing balance', col.part + PAD, b1)
    let ly = y + C.rowPad + lineH(F.body)
    for (const line of closingLines) {
      font(true, F.detail, COLOR.detail)
      put(line, col.part + PAD, baseline(ly, F.detail))
      ly += lineH(F.detail)
    }
    balanceCell(d.closing, b1, true)
    hrule(L, y + it.height, R, COLOR.brand, 0.5)
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
    const pageText = `Page ${p} of ${pages}`
    font(false, F.footer, COLOR.light)
    put(pageText, R, footY, 'right')
    // The customer is named in every page's header; the footer names them too when there is room, and
    // otherwise leaves the name out rather than cutting it.
    const maxW = W - doc.getTextWidth(pageText) - 8
    const full = `${d.business.name} · ${d.title} · ${d.customerName}`
    put(doc.getTextWidth(full) <= maxW ? full : `${d.business.name} · ${d.title}`, L, footY)
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
