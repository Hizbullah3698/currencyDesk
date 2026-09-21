import { jsPDF } from 'jspdf'
import { COLOR, STATEMENT_CONFIG, type RGB, type StatementConfig } from './statementConfig'
import { layoutStatement, type LayoutItem } from './statementLayout'
import { formatPaisa, splitBalance } from './statementMoney'
import type { StatementDocument, StatementEntry } from './statementDoc'

// ---------------------------------------------------------------------------
// Draws a StatementDocument onto portrait A4
// ---------------------------------------------------------------------------
//
// Decides only WHERE things go and how they look. What the statement says — every figure, every
// description — was settled in statementDoc.ts, in plain data; the arithmetic of the page breaks is in
// statementLayout.ts; the palette and every dimension are in statementConfig.ts. This file is the part
// that touches jsPDF, and the only one that does, so it is loaded lazily (the Print button `import()`s it)
// and the ~130 KB library is never part of the main bundle.
//
// THE LOOK. One brand colour carries identity and hierarchy — the top band, the date headings, the closing
// figure — and a 6% tint of it stripes alternate rows, with no lines between them. Everything else is ink
// and greys. There is no red or green anywhere: colour never carries meaning, so a black-and-white copy
// loses nothing (`grayscale: true` renders exactly that, for checking). Numbers are right-aligned and
// black; the Dr/Cr after a balance is smaller and lighter, held in a fixed slot at the column's edge so the
// DIGITS stay aligned whether or not a side is printed.
//
// Standard PDF fonts only (Helvetica). Its digits are all the same width, so a right-aligned column of
// figures lines up decimal point over decimal point without a monospaced face. Text the font cannot print
// never reaches here: statementDoc.ts has already replaced it and reported it.

export interface RenderOptions {
  config?: StatementConfig
  /** Compressed streams are smaller; uncompressed lets a test read the text straight out of the bytes. */
  compress?: boolean
  /** Renders every colour as its grey, to see what a black-and-white printer will make of it. */
  grayscale?: boolean
}

const PAD = 1.8
const ELLIPSIS = '...'
/** Width held at the right edge of the Balance column for the small Dr/Cr, so digits align with or without one. */
const SIDE_SLOT = 5.6
/** Vertical centring: the visual centre of a line of text sits this fraction of its point size above the baseline. */
const CAP = 0.3528 * 0.36

export function renderStatementPdf(d: StatementDocument, opts: RenderOptions = {}): jsPDF {
  const C = opts.config ?? STATEMENT_CONFIG
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: opts.compress ?? true })
  doc.setProperties({ title: `${d.title} - ${d.customerName}`, subject: d.title, creator: d.deskName })

  const PW = C.page.width
  const L = C.margin.left
  const R = PW - C.margin.right
  const W = R - L
  const col = {
    desc: L,
    ref: L + C.columns.description,
    debit: L + C.columns.description + C.columns.ref,
    credit: L + C.columns.description + C.columns.ref + C.columns.debit,
    bal: L + C.columns.description + C.columns.ref + C.columns.debit + C.columns.credit,
  }
  const dec = d.decimals

  // --- colour: through one function, so a grayscale proof is honest about every mark on the page ---
  const tone = (c: RGB): RGB => {
    if (!opts.grayscale) return c
    const y = Math.round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])
    return [y, y, y]
  }

  // --- small drawing helpers ---
  const font = (style: 'normal' | 'bold', size: number, color: RGB = COLOR.ink) => {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    const c = tone(color)
    doc.setTextColor(c[0], c[1], c[2])
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
  /** Baseline that centres a line of `size` pt vertically in a row starting at `y` with height `h`. */
  const baseline = (y: number, h: number, size: number) => y + h / 2 + size * CAP
  /** Fits `text` into `maxW` at the CURRENT font, ending in "..." when it had to be cut. */
  const fit = (text: string, maxW: number): string => {
    if (doc.getTextWidth(text) <= maxW) return text
    let t = text
    while (t.length > 1 && doc.getTextWidth(t + ELLIPSIS) > maxW) t = t.slice(0, -1)
    return t.trimEnd() + ELLIPSIS
  }
  const rightOf = (text: string, colLeft: number, colWidth: number, y: number) => doc.text(text, colLeft + colWidth - PAD, y, { align: 'right' })
  const money = (p: number) => formatPaisa(p, dec)

  /** Digits then, after them, a small lighter side. Left-aligned at x. */
  function digitsThenSide(x: number, y: number, amount: string, side: string, size: number, sideSize: number, bold: boolean, color: RGB, sideColor: RGB): void {
    font(bold ? 'bold' : 'normal', size, color)
    doc.text(amount, x, y)
    if (side) {
      const end = x + doc.getTextWidth(amount)
      font('normal', sideSize, sideColor)
      doc.text(side, end + 1.3, y)
    }
  }

  /** A Balance-column cell: digits right-aligned to a fixed edge, the side in a fixed slot beyond it. */
  function balanceCell(net: number, y: number, size: number, bold: boolean) {
    const { amount, side } = splitBalance(net, dec)
    font(bold ? 'bold' : 'normal', size)
    doc.text(amount, col.bal + C.columns.balance - PAD - SIDE_SLOT, y, { align: 'right' })
    if (side) {
      font('normal', C.font.small, COLOR.light)
      doc.text(side, col.bal + C.columns.balance - PAD, y, { align: 'right' })
    }
  }

  // ------------------------------------------------------------------ page-1 top: band, customer, summary strip
  function drawFirstHeader(): number {
    // The band. `logoWidth` is space held at its left for a logo that does not exist yet.
    const bh = C.band.height
    fill(0, 0, PW, bh, COLOR.brand)
    const nameX = L + C.band.logoWidth + (C.band.logoWidth ? 4 : 0)
    font('bold', C.font.bandName, COLOR.white)
    doc.text(d.deskName, nameX, baseline(0, bh, C.font.bandName))
    font('normal', C.font.bandTitle, COLOR.white)
    doc.text(d.title, R, baseline(0, bh, C.font.bandTitle), { align: 'right' })

    // Customer, large; then one grey line of the plain facts.
    let y = bh + 12
    font('bold', C.font.name)
    doc.text(fit(d.customerName, W), L, y)
    y += 6.4
    font('normal', C.font.body, COLOR.detail)
    doc.text(fit(`Account ${d.accountId} · ${d.periodFrom} to ${d.periodTo} · Generated ${d.generatedAt}`, W), L, y)

    // The summary: one strip of four. Closing is the only large figure, in the brand colour.
    const top = y + 5.2
    const h = 17
    fill(L, top, W, h, COLOR.tint)
    const widths = [38, 38, 38, W - 114]
    let x = L
    const cells: { label: string; net: number; kind: 'plain' | 'sided' | 'closing' }[] = [
      { label: 'Opening balance', net: d.opening, kind: 'sided' },
      { label: 'Total debits', net: d.totalDebits, kind: 'plain' },
      { label: 'Total credits', net: d.totalCredits, kind: 'plain' },
      { label: 'Closing balance', net: d.closing, kind: 'closing' },
    ]
    cells.forEach((cell, i) => {
      const cx = x + 4.5
      font('normal', C.font.label, COLOR.light)
      doc.text(cell.label.toUpperCase(), cx, top + 5.4)
      if (cell.kind === 'closing') {
        const { amount, side } = splitBalance(cell.net, dec)
        digitsThenSide(cx, top + 13.6, amount, side, C.font.closingValue, C.font.value - 1.2, true, COLOR.brand, COLOR.brand)
      } else if (cell.kind === 'sided') {
        const { amount, side } = splitBalance(cell.net, dec)
        digitsThenSide(cx, top + 12.4, amount, side, C.font.value, C.font.small, true, COLOR.ink, COLOR.light)
      } else {
        // Totals carry no Dr/Cr: the label already says which side they are.
        font('bold', C.font.value)
        doc.text(money(cell.net), cx, top + 12.4)
      }
      x += widths[i]
    })
    return top + h + 5
  }

  /** Later pages: a slim brand line, the customer, "continued" — no band. */
  function drawContinuationHeader(): void {
    fill(0, 0, PW, 1.6, COLOR.brand)
    font('bold', 10)
    doc.text(fit(d.customerName, W - 30), L, 9.4)
    font('normal', C.font.small + 0.6, COLOR.light)
    doc.text('continued', R, 9.4, { align: 'right' })
  }
  const laterTop = 13

  /** Small uppercase grey labels with a thin rule under them. */
  function drawTableHead(y: number): void {
    const ty = baseline(y, C.row.tableHead, C.font.label)
    font('bold', C.font.label, COLOR.light)
    doc.text('DESCRIPTION', col.desc + PAD, ty)
    doc.text('REF', col.ref + PAD, ty)
    rightOf('DEBIT', col.debit, C.columns.debit, ty)
    rightOf('CREDIT', col.credit, C.columns.credit, ty)
    doc.text('BALANCE', col.bal + C.columns.balance - PAD, ty, { align: 'right' })
    hrule(L, y + C.row.tableHead, R, COLOR.rule, 0.2)
  }

  /** A day heading: the date in the brand colour, bold, with a thin brand rule under it. */
  function drawDateBand(y: number, label: string): void {
    font('bold', C.font.body + 0.3, COLOR.brand)
    doc.text(label, col.desc + PAD, y + C.row.date - 2.7)
    hrule(L, y + C.row.date - 0.5, R, COLOR.brand, 0.25)
  }

  /** The type in bold, then the details after it in grey — one line, cut with "..." only if it must be. */
  function drawDescription(x: number, y: number, maxW: number, e: StatementEntry): void {
    font('bold', C.font.body)
    let type = e.type
    if (doc.getTextWidth(type) > maxW) type = fit(type, maxW)
    doc.text(type, x, y)
    const rest = e.detail ? `${e.joiner}${e.detail}` : ''
    if (!rest || type !== e.type) return
    // Measured ONCE, in the bold face it was drawn in. Measuring again after switching to the regular face
    // gives a narrower width, so the detail started too far left and its leading dot landed under the last
    // letter of a long type ("Payment received").
    const typeW = doc.getTextWidth(type)
    // A plain-space joiner (a transfer's other customer, a journal reference) is too tight against bold type
    // at this size, so it gets a little air; the middle-dot joiner already has spaces around the dot.
    const air = e.joiner === ' ' ? 0.9 : 0
    font('normal', C.font.body, COLOR.detail)
    doc.text(fit(rest, maxW - typeW - air), x + typeW + air, y)
  }

  // ------------------------------------------------------------------ table items, flat and in order
  type Drawn =
    | { kind: 'opening' }
    | { kind: 'date'; label: string }
    | { kind: 'entry'; entry: StatementEntry; stripe: boolean }
    | { kind: 'closing' }
  const drawn: Drawn[] = [{ kind: 'opening' }]
  const items: LayoutItem[] = [{ kind: 'opening', height: C.row.opening }]
  /** For each table item, the date label of the day it belongs to — so a band can be repeated on a new page. */
  const dayOf: string[] = ['']
  for (const g of d.groups) {
    drawn.push({ kind: 'date', label: g.label })
    items.push({ kind: 'date', height: C.row.date })
    dayOf.push(g.label)
    g.entries.forEach((e, n) => {
      // Alternate rows within a day carry the tint; the first of each day is plain.
      drawn.push({ kind: 'entry', entry: e, stripe: n % 2 === 1 })
      items.push({ kind: 'entry', height: C.row.entry })
      dayOf.push(g.label)
    })
  }
  drawn.push({ kind: 'closing' })
  items.push({ kind: 'closing', height: C.row.closing })
  dayOf.push('')

  // ------------------------------------------------------------------ the sections after the table
  // Same pitch and tint as the table, small grey labels, no boxes.
  const pitch = C.row.entry
  const NOTE = 4.6
  const positionsH = d.positions.length ? C.row.sectionLabel + d.positions.length * pitch + NOTE : 0
  const chequeRows = Math.max(d.pendingCheques.length, 1)
  const chequesH = C.row.sectionLabel + NOTE + (d.pendingCheques.length ? C.row.tableHead : 0) + chequeRows * pitch + 2 * pitch + 1.5
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
    if (band) drawDateBand(band.y, `${dayOf[i]} (continued)`)
    const y = at.y

    if (it.kind === 'date') return drawDateBand(y, it.label)

    if (it.kind === 'opening') {
      const by = baseline(y, C.row.opening, C.font.body)
      font('bold', C.font.body)
      doc.text('Opening balance', col.desc + PAD, by)
      balanceCell(d.opening, by, C.font.body, true)
      return
    }

    if (it.kind === 'entry') {
      const e = it.entry
      if (it.stripe) fill(L, y, W, C.row.entry, COLOR.tint)
      const by = baseline(y, C.row.entry, C.font.body)
      drawDescription(col.desc + PAD, by, C.columns.description - PAD * 2, e)
      font('normal', C.font.small, COLOR.light)
      doc.text(fit(e.ref, C.columns.ref - PAD * 2), col.ref + PAD, by)
      font('normal', C.font.body)
      if (e.debit) rightOf(money(e.debit), col.debit, C.columns.debit, by)
      if (e.credit) rightOf(money(e.credit), col.credit, C.columns.credit, by)
      balanceCell(e.balance, by, C.font.body, false)
      return
    }

    // closing: a tinted band under a brand rule, bold. The totals carry no Dr/Cr — their column headings say it.
    fill(L, y, W, C.row.closing, COLOR.tint)
    hrule(L, y, R, COLOR.brand, 0.45)
    const by = baseline(y, C.row.closing, C.font.body + 0.4)
    font('bold', C.font.body + 0.4)
    doc.text('Closing balance', col.desc + PAD, by)
    rightOf(money(d.totalDebits), col.debit, C.columns.debit, by)
    rightOf(money(d.totalCredits), col.credit, C.columns.credit, by)
    balanceCell(d.closing, by, C.font.body + 0.4, true)
  })

  // --- sections ---
  let b = 0
  const section = (draw: (top: number) => void) => {
    const at = layout.blocks[b++]
    goToPage(at.page)
    draw(at.y)
  }
  const label = (text: string, top: number) => {
    font('bold', C.font.label, COLOR.light)
    doc.text(text, L + PAD, baseline(top, C.row.sectionLabel, C.font.label))
  }

  if (d.positions.length) {
    section((top) => {
      label('CURRENCY POSITION', top)
      let y = top + C.row.sectionLabel
      d.positions.forEach((p, n) => {
        if (n % 2 === 1) fill(L, y, W, pitch, COLOR.tint)
        const by = baseline(y, pitch, C.font.body)
        font('bold', C.font.body)
        doc.text(p.code, col.desc + PAD, by)
        font('normal', C.font.body, COLOR.detail)
        doc.text(p.sideLabel, L + 22, by)
        font('normal', C.font.body)
        doc.text(`${p.unitsLabel} ${p.code}`, L + 118, by, { align: 'right' })
        doc.text(`PKR ${money(p.value)}`, R - PAD, by, { align: 'right' })
        y += pitch
      })
      font('normal', C.font.note, COLOR.light)
      doc.text('Net units for each currency separately, never added across currencies. Value in PKR at the deal rates.', L + PAD, y + 3.2)
    })
  }

  section((top) => {
    label('PENDING CHEQUES (NOT YET CLEARED)', top)
    let y = top + C.row.sectionLabel
    font('normal', C.font.note, COLOR.light)
    doc.text('These do not affect the balance above until they clear.', L + PAD, y + 2.6)
    y += NOTE
    const cx = { dir: L + PAD, num: L + 34, bank: L + 62, due: L + 112, status: L + 138, amt: R - PAD }
    if (d.pendingCheques.length) {
      const ty = baseline(y, C.row.tableHead, C.font.label)
      font('bold', C.font.label, COLOR.light)
      doc.text('DIRECTION', cx.dir, ty)
      doc.text('CHEQUE NO.', cx.num, ty)
      doc.text('BANK', cx.bank, ty)
      doc.text('DUE', cx.due, ty)
      doc.text('STATUS', cx.status, ty)
      doc.text('AMOUNT', cx.amt, ty, { align: 'right' })
      hrule(L, y + C.row.tableHead, R, COLOR.rule, 0.2)
      y += C.row.tableHead
    }
    if (!d.pendingCheques.length) {
      font('normal', C.font.body, COLOR.detail)
      doc.text('None.', L + PAD, baseline(y, pitch, C.font.body))
      y += pitch
    }
    d.pendingCheques.forEach((q, n) => {
      if (n % 2 === 1) fill(L, y, W, pitch, COLOR.tint)
      const by = baseline(y, pitch, C.font.body)
      font('normal', C.font.body)
      doc.text(q.directionLabel, cx.dir, by)
      doc.text(fit(q.number, 26), cx.num, by)
      doc.text(fit(q.bank, 46), cx.bank, by)
      doc.text(q.dueLabel, cx.due, by)
      font('normal', C.font.body, COLOR.detail)
      doc.text(q.status, cx.status, by)
      font('normal', C.font.body)
      doc.text(money(q.amount), cx.amt, by, { align: 'right' })
      y += pitch
    })
    y += 1.5
    hrule(L, y, R, COLOR.rule, 0.2)
    const totals: [string, number][] = [
      ['Total cheques in (received)', d.pendingIn],
      ['Total cheques out (issued)', d.pendingOut],
    ]
    totals.forEach(([text, value], n) => {
      if (n % 2 === 1) fill(L, y, W, pitch, COLOR.tint)
      const by = baseline(y, pitch, C.font.body)
      font('bold', C.font.body)
      doc.text(text, L + PAD, by)
      doc.text(money(value), R - PAD, by, { align: 'right' })
      y += pitch
    })
  })

  goToPage(layout.pages)

  // --- footer on every page, once the page count is known ---
  const total = doc.getNumberOfPages()
  const footY = C.page.height - 8
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    hrule(L, footY - 3.6, R, COLOR.rule, 0.2)
    font('normal', C.font.small, COLOR.light)
    doc.text(d.customerName, L, footY)
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
