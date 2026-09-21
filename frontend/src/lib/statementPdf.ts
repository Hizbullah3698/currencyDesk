import { jsPDF } from 'jspdf'
import { STATEMENT_CONFIG, type StatementConfig } from './statementConfig'
import { layoutStatement, type LayoutItem } from './statementLayout'
import { formatBalance, formatPaisa } from './statementMoney'
import type { StatementDocument } from './statementDoc'

// ---------------------------------------------------------------------------
// Draws a StatementDocument onto portrait A4
// ---------------------------------------------------------------------------
//
// Decides only WHERE things go. What the statement says — every figure, every description — was settled
// in statementDoc.ts, in plain data; the arithmetic of the page breaks is in statementLayout.ts. This
// file is the part that touches jsPDF, and it is the only one that does, so it is loaded lazily (the
// Print button `import()`s it) and the ~130 KB library is never part of the main bundle.
//
// Standard PDF fonts only (Helvetica). Its digits are all the same width, so a right-aligned column of
// figures lines up decimal point over decimal point without needing a monospaced face. Text the font
// cannot print never reaches here: statementDoc.ts has already replaced it and reported it.

export interface RenderOptions {
  config?: StatementConfig
  /** Compressed streams are smaller; uncompressed lets a test read the text straight out of the bytes. */
  compress?: boolean
}

type RGB = [number, number, number]
const INK: RGB = [20, 24, 31]
const MUTED: RGB = [100, 108, 120]
const RULE: RGB = [205, 210, 218]
const STRONG_RULE: RGB = [60, 66, 78]
const HEAD_FILL: RGB = [228, 232, 238]
const DATE_FILL: RGB = [242, 244, 247]
const BOX_FILL: RGB = [248, 249, 251]

const PAD = 1.6
const ELLIPSIS = '...'

export function renderStatementPdf(d: StatementDocument, opts: RenderOptions = {}): jsPDF {
  const C = opts.config ?? STATEMENT_CONFIG
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: opts.compress ?? true })
  doc.setProperties({ title: `${d.title} - ${d.customerName}`, subject: d.title, creator: d.deskName })

  const L = C.margin.left
  const R = C.page.width - C.margin.right
  const W = R - L
  const col = {
    desc: L,
    ref: L + C.columns.description,
    debit: L + C.columns.description + C.columns.ref,
    credit: L + C.columns.description + C.columns.ref + C.columns.debit,
    bal: L + C.columns.description + C.columns.ref + C.columns.debit + C.columns.credit,
  }
  const dec = d.decimals

  // --- small drawing helpers ---
  const font = (style: 'normal' | 'bold', size: number, color: RGB = INK) => {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    doc.setTextColor(color[0], color[1], color[2])
  }
  const rule = (x1: number, y: number, x2: number, color: RGB = RULE, width = 0.15) => {
    doc.setDrawColor(color[0], color[1], color[2])
    doc.setLineWidth(width)
    doc.line(x1, y, x2, y)
  }
  const vrule = (x: number, y1: number, y2: number, color: RGB = RULE, width = 0.2) => {
    doc.setDrawColor(color[0], color[1], color[2])
    doc.setLineWidth(width)
    doc.line(x, y1, x, y2)
  }
  const fill = (x: number, y: number, w: number, h: number, color: RGB) => {
    doc.setFillColor(color[0], color[1], color[2])
    doc.rect(x, y, w, h, 'F')
  }
  const outline = (x: number, y: number, w: number, h: number, color: RGB = RULE) => {
    doc.setDrawColor(color[0], color[1], color[2])
    doc.setLineWidth(0.2)
    doc.rect(x, y, w, h, 'S')
  }
  /** Fits `text` into `maxW` at the CURRENT font, ending in "..." when it had to be cut. */
  const fit = (text: string, maxW: number): string => {
    if (doc.getTextWidth(text) <= maxW) return text
    let t = text
    while (t.length > 1 && doc.getTextWidth(t + ELLIPSIS) > maxW) t = t.slice(0, -1)
    return t.trimEnd() + ELLIPSIS
  }
  const right = (text: string, colLeft: number, colWidth: number, y: number) => doc.text(text, colLeft + colWidth - PAD, y, { align: 'right' })
  const money = (p: number) => (p === 0 ? '' : formatPaisa(p, dec))
  /** "1,234.56 Dr" for a total with a known side: a zero has no side and prints bare. */
  const sided = (p: number, side: 'Dr' | 'Cr') => (p === 0 ? formatPaisa(0, dec) : `${formatPaisa(p, dec)} ${side}`)

  // ------------------------------------------------------------------ first-page header + summary
  function drawFirstHeader(): number {
    let y = C.margin.top
    font('bold', C.font.sub + 1, MUTED)
    doc.text(d.deskName, L, y + 3.5)
    font('bold', C.font.heading + 1)
    doc.text(d.title, L, y + 10.6)
    rule(L, y + 13.5, R, STRONG_RULE, 0.5)
    y += 16.5

    // Customer / period block: two columns of label over value.
    const half = W / 2
    const pair = (label: string, value: string, x: number, yy: number, maxW: number) => {
      font('normal', C.font.tiny, MUTED)
      doc.text(label.toUpperCase(), x, yy)
      font('bold', C.font.sub + 1)
      doc.text(fit(value, maxW), x, yy + 4.4)
    }
    pair('Customer', d.customerName, L, y, half - 6)
    pair('Period', `${d.periodFrom} to ${d.periodTo}`, L + half, y, half)
    pair('Account ID', d.accountId, L, y + 8.6, half - 6)
    pair('Generated', d.generatedAt, L + half, y + 8.6, half)
    y += 17.6

    // Summary box: opening + debits - credits = closing.
    const boxH = 14
    fill(L, y, W, boxH, BOX_FILL)
    outline(L, y, W, boxH, STRONG_RULE)
    const cells: [string, string][] = [
      ['Opening balance', formatBalance(d.opening, dec)],
      ['Total debits', sided(d.totalDebits, 'Dr')],
      ['Total credits', sided(d.totalCredits, 'Cr')],
      ['Closing balance', formatBalance(d.closing, dec)],
    ]
    const cw = W / 4
    cells.forEach(([label, value], i) => {
      const x = L + i * cw
      if (i > 0) vrule(x, y + 2, y + boxH - 2)
      font('normal', C.font.tiny, MUTED)
      doc.text(label.toUpperCase(), x + 3, y + 4.2)
      font('bold', C.font.summaryValue + (i === 3 ? 0.5 : 0))
      doc.text(value, x + 3, y + 10.4)
    })
    y += boxH + 3.4
    font('normal', C.font.tiny, MUTED)
    doc.text('Opening balance + Total debits - Total credits = Closing balance', L + W / 2, y, { align: 'center' })
    return y + 3
  }

  function drawContinuationHeader(): void {
    font('bold', C.font.sub)
    doc.text(`${d.title} - ${d.customerName}`, L, C.margin.top + 3.5)
    font('normal', C.font.small, MUTED)
    doc.text(`Account ID ${d.accountId}  |  ${d.periodFrom} to ${d.periodTo}  |  continued`, R, C.margin.top + 3.5, { align: 'right' })
    rule(L, C.margin.top + 6, R, STRONG_RULE, 0.4)
  }
  const laterTop = C.margin.top + 9

  function drawTableHead(y: number): void {
    fill(L, y, W, C.row.tableHead, HEAD_FILL)
    font('bold', C.font.body)
    const ty = y + C.row.tableHead * 0.68
    doc.text('Description', col.desc + PAD, ty)
    doc.text('Ref', col.ref + PAD, ty)
    right('Debit', col.debit, C.columns.debit, ty)
    right('Credit', col.credit, C.columns.credit, ty)
    right('Balance', col.bal, C.columns.balance, ty)
    rule(L, y + C.row.tableHead, R, STRONG_RULE, 0.3)
  }

  // ------------------------------------------------------------------ table items, flat and in order
  type Drawn =
    | { kind: 'opening' }
    | { kind: 'date'; label: string }
    | { kind: 'entry'; entry: StatementDocument['groups'][number]['entries'][number] }
    | { kind: 'closing' }
  const drawn: Drawn[] = [{ kind: 'opening' }]
  const items: LayoutItem[] = [{ kind: 'opening', height: C.row.opening }]
  /** For each table item, the date label of the day it belongs to — so a band can be repeated on a new page. */
  const dayOf: string[] = ['']
  for (const g of d.groups) {
    drawn.push({ kind: 'date', label: g.label })
    items.push({ kind: 'date', height: C.row.date })
    dayOf.push(g.label)
    for (const e of g.entries) {
      drawn.push({ kind: 'entry', entry: e })
      items.push({ kind: 'entry', height: C.row.entry })
      dayOf.push(g.label)
    }
  }
  drawn.push({ kind: 'closing' })
  dayOf.push('')
  items.push({ kind: 'closing', height: C.row.closing })

  // ------------------------------------------------------------------ boxes after the table
  const BOX_TITLE = 6.4
  const BOX_LINE = 4.6
  const BOX_NOTE = 4.6
  const positionsH = d.positions.length ? BOX_TITLE + d.positions.length * BOX_LINE + BOX_NOTE + 2 : 0
  const chequeLines = Math.max(d.pendingCheques.length, 1)
  const chequesH = BOX_TITLE + BOX_NOTE + (d.pendingCheques.length ? BOX_LINE : 0) + chequeLines * BOX_LINE + 2 * BOX_LINE + 2
  const blockHeights = [positionsH, chequesH].filter((h) => h > 0)

  // ------------------------------------------------------------------ lay out, then draw
  const firstTop = drawFirstHeader()
  const bottom = C.page.height - C.margin.bottom
  const layout = layoutStatement({
    items,
    blockHeights,
    firstTop,
    laterTop,
    bottom,
    tableHead: C.row.tableHead,
    keepWithClosing: C.keepWithClosing,
    blockGap: 5,
    bandHeight: C.row.date,
  })

  drawTableHead(firstTop)
  let page = 1
  const goToPage = (target: number) => {
    while (page < target) {
      doc.addPage()
      page++
      drawContinuationHeader()
      if (layout.tablePages.includes(page)) drawTableHead(laterTop)
    }
  }

  drawn.forEach((it, i) => {
    const at = layout.items[i]
    goToPage(at.page)
    // A day that carries on from the page before repeats its band, marked "continued".
    const band = layout.bands.find((b) => b.itemIndex === i)
    if (band) {
      fill(L, band.y, W, C.row.date, DATE_FILL)
      font('bold', C.font.body)
      doc.text(`${dayOf[i]} (continued)`, col.desc + PAD, band.y + C.row.date * 0.7)
    }
    const y = at.y
    const base = (h: number) => y + h * 0.7

    if (it.kind === 'date') {
      fill(L, y, W, C.row.date, DATE_FILL)
      font('bold', C.font.body)
      doc.text(it.label, col.desc + PAD, base(C.row.date))
      return
    }
    if (it.kind === 'opening') {
      fill(L, y, W, C.row.opening, BOX_FILL)
      font('bold', C.font.body)
      doc.text('Opening balance', col.desc + PAD, base(C.row.opening))
      right(formatBalance(d.opening, dec), col.bal, C.columns.balance, base(C.row.opening))
      rule(L, y + C.row.opening, R)
      return
    }
    if (it.kind === 'entry') {
      const e = it.entry
      font('normal', C.font.body)
      doc.text(fit(e.description, C.columns.description - PAD * 2), col.desc + PAD, base(C.row.entry))
      font('normal', C.font.small, MUTED)
      doc.text(fit(e.ref, C.columns.ref - PAD * 2), col.ref + PAD, base(C.row.entry))
      font('normal', C.font.body)
      if (e.debit) right(money(e.debit), col.debit, C.columns.debit, base(C.row.entry))
      if (e.credit) right(money(e.credit), col.credit, C.columns.credit, base(C.row.entry))
      right(formatBalance(e.balance, dec), col.bal, C.columns.balance, base(C.row.entry))
      rule(L, y + C.row.entry, R)
      return
    }
    // closing
    rule(L, y, R, STRONG_RULE, 0.5)
    fill(L, y + 0.25, W, C.row.closing - 0.25, HEAD_FILL)
    font('bold', C.font.body + 0.4)
    doc.text('Closing balance', col.desc + PAD, base(C.row.closing))
    right(sided(d.totalDebits, 'Dr'), col.debit, C.columns.debit, base(C.row.closing))
    right(sided(d.totalCredits, 'Cr'), col.credit, C.columns.credit, base(C.row.closing))
    right(formatBalance(d.closing, dec), col.bal, C.columns.balance, base(C.row.closing))
    rule(L, y + C.row.closing, R, STRONG_RULE, 0.5)
  })

  // --- boxes ---
  let b = 0
  const box = (h: number, draw: (top: number) => void) => {
    const at = layout.blocks[b++]
    goToPage(at.page)
    fill(L, at.y, W, h, BOX_FILL)
    outline(L, at.y, W, h)
    draw(at.y)
  }

  if (d.positions.length) {
    box(positionsH, (top) => {
      font('bold', C.font.body)
      doc.text('Currency position', L + 3, top + 4.4)
      let y = top + BOX_TITLE
      d.positions.forEach((p) => {
        font('bold', C.font.body)
        doc.text(p.code, L + 3, y + 3.4)
        font('normal', C.font.body)
        doc.text(p.sideLabel, L + 17, y + 3.4)
        doc.text(`${p.unitsLabel} ${p.code}`, L + 92, y + 3.4, { align: 'right' })
        font('normal', C.font.body, MUTED)
        doc.text(`PKR ${formatPaisa(p.value, dec)}`, R - 3, y + 3.4, { align: 'right' })
        y += BOX_LINE
      })
      font('normal', C.font.tiny, MUTED)
      doc.text('Net units for each currency separately, never added across currencies. Value in PKR at the deal rates.', L + 3, y + 3)
    })
  }

  box(chequesH, (top) => {
    font('bold', C.font.body)
    doc.text('Pending cheques (not yet cleared)', L + 3, top + 4.4)
    font('normal', C.font.tiny, MUTED)
    doc.text('These do not affect the balance above until they clear.', L + 3, top + BOX_TITLE + 2.6)
    let y = top + BOX_TITLE + BOX_NOTE
    const cx = { dir: L + 3, num: L + 34, bank: L + 62, due: L + 112, status: L + 138, amt: R - 3 }
    if (d.pendingCheques.length) {
      font('bold', C.font.small, MUTED)
      doc.text('DIRECTION', cx.dir, y + 3)
      doc.text('CHEQUE NO.', cx.num, y + 3)
      doc.text('BANK', cx.bank, y + 3)
      doc.text('DUE', cx.due, y + 3)
      doc.text('STATUS', cx.status, y + 3)
      doc.text('AMOUNT', cx.amt, y + 3, { align: 'right' })
      y += BOX_LINE
    }
    if (!d.pendingCheques.length) {
      font('normal', C.font.body, MUTED)
      doc.text('None.', L + 3, y + 3.4)
      y += BOX_LINE
    }
    d.pendingCheques.forEach((q) => {
      font('normal', C.font.body)
      doc.text(q.directionLabel, cx.dir, y + 3.4)
      doc.text(fit(q.number, 26), cx.num, y + 3.4)
      doc.text(fit(q.bank, 46), cx.bank, y + 3.4)
      doc.text(q.dueLabel, cx.due, y + 3.4)
      doc.text(q.status, cx.status, y + 3.4)
      doc.text(formatPaisa(q.amount, dec), cx.amt, y + 3.4, { align: 'right' })
      y += BOX_LINE
    })
    rule(L + 3, y + 0.6, R - 3)
    font('bold', C.font.body)
    doc.text('Total cheques in (received)', L + 3, y + 4.6)
    doc.text(formatPaisa(d.pendingIn, dec), R - 3, y + 4.6, { align: 'right' })
    doc.text('Total cheques out (issued)', L + 3, y + 4.6 + BOX_LINE)
    doc.text(formatPaisa(d.pendingOut, dec), R - 3, y + 4.6 + BOX_LINE, { align: 'right' })
  })

  goToPage(layout.pages)

  // --- footer on every page, once the page count is known ---
  const total = doc.getNumberOfPages()
  const footY = C.page.height - 8
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    rule(L, footY - 3.4, R, RULE)
    font('normal', C.font.small, MUTED)
    doc.text(`${d.customerName}  |  Generated ${d.generatedAt}`, L, footY)
    doc.text(`Page ${p} of ${total}`, R, footY, { align: 'right' })
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

