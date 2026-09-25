// ---------------------------------------------------------------------------
// Where each line of the statement goes, page by page
// ---------------------------------------------------------------------------
//
// Pure arithmetic on heights — no PDF, no fonts — so the page-break rules can be tested with plain
// numbers. The renderer measures each item (rows wrap, so heights vary), hands the heights here, and
// draws wherever this says.
//
// THE LEDGER (layoutLedger):
//
//   1. THE TABLE HEADER REPEATS on every page that carries ledger rows.
//   2. A ROW IS NEVER SPLIT across pages; it moves whole to the next page.
//   3. BALANCE CARRIED FORWARD / BROUGHT FORWARD. Where the ledger breaks, the page ends with a "Balance
//      carried forward" row and the next page starts with "Balance brought forward", both showing the
//      running balance after the last row above the break. Room for the carried-forward row is reserved
//      under every row that could be the last on its page, so it always fits. These rows are
//      PRESENTATION ONLY: the layout says where they go and after which item; the renderer prints the
//      running balance the document model already computed. They are not entries and touch no total.
//   4. THE CLOSING BALANCE IS NEVER ALONE. The last `keepWithClosing` entries, the period-totals row and
//      the closing row are placed as ONE unit: if they do not all fit in what is left of the page, the
//      whole unit moves to the next page together.
//   5. The opening row is kept with the row beneath it.
//
// THE SECTIONS after the ledger (layoutSections): each section's heading, note and column heads are
// kept with its first row (no orphaned heading); a section that runs over a page break repeats its
// column heads on the new page; totals are kept with the row above them; and nothing forces a new page
// when the section fits under the ledger.

export type LedgerKind = 'opening' | 'entry' | 'totals' | 'closing'

export interface LedgerItem {
  kind: LedgerKind
  height: number
}

export interface Placed {
  /** 1-based. */
  page: number
  /** Top of the item, mm from the top of the sheet. */
  y: number
}

export interface LedgerLayoutParams {
  /** opening, then entries, then totals, then closing. */
  items: LedgerItem[]
  /** Where the table header goes on page 1 (below the document header and summary). */
  firstTop: number
  /** Where the table header goes on pages 2 onward. */
  laterTop: number
  /** The lowest y a line may occupy. */
  bottom: number
  /** Height of the (repeated) table header row. */
  tableHead: number
  /** Height of a carried-forward / brought-forward row. */
  continuity: number
  /** Entries kept together with the totals and closing rows. */
  keepWithClosing: number
}

/** A continuity row: on `page` at `y`, showing the running balance after item `afterItem`. */
export interface Continuity {
  page: number
  y: number
  afterItem: number
}

export interface LedgerLayout {
  items: Placed[]
  /** "Balance carried forward" rows, at the foot of each page the ledger leaves. */
  carried: Continuity[]
  /** "Balance brought forward" rows, at the head of each page the ledger continues onto. */
  brought: Continuity[]
  /** Pages carrying ledger rows, each of which gets the table header. */
  tablePages: number[]
  /** Page and y where the ledger ends. */
  endPage: number
  endY: number
}

/** Index where the closing unit starts: the last N entries (or everything after the opening row, if fewer). */
export function closingUnitStart(items: LedgerItem[], keep: number): number {
  let seen = 0
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === 'opening') return i + 1
    if (items[i].kind === 'entry' && ++seen >= keep) return i
  }
  return 0
}

export function layoutLedger(p: LedgerLayoutParams): LedgerLayout {
  const { items } = p
  const tableTop = (page: number) => (page === 1 ? p.firstTop : p.laterTop) + p.tableHead

  let page = 1
  let y = tableTop(1)
  /** Where content begins on the current page — nothing is ever moved off a page it would start. */
  let pageStart = y
  const placed: Placed[] = []
  const carried: Continuity[] = []
  const brought: Continuity[] = []
  const tablePages = [1]

  const unitStart = closingUnitStart(items, p.keepWithClosing)
  const unitHeight = items.slice(unitStart).reduce((s, it) => s + it.height, 0)

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    let need: number
    if (i === unitStart) need = unitHeight
    else if (i > unitStart) need = it.height // only if the unit is taller than a page (never in practice)
    else {
      need = it.height
      if (it.kind === 'opening' && items[i + 1] && i + 1 < unitStart) need += items[i + 1].height
      // Room to close this page with "carried forward" if the next row does not fit.
      need += p.continuity
    }

    if (y + need > p.bottom + 1e-9 && y > pageStart + 1e-9) {
      carried.push({ page, y, afterItem: i - 1 })
      page++
      tablePages.push(page)
      y = tableTop(page)
      brought.push({ page, y, afterItem: i - 1 })
      y += p.continuity
      pageStart = y
    }
    placed.push({ page, y })
    y += it.height
  }

  return { items: placed, carried, brought, tablePages, endPage: page, endY: y }
}

// ------------------------------------------------------------------ sections

export interface SectionItem {
  /** Which section this belongs to (0, 1, ...). */
  section: number
  height: number
  /** Must share a page with the item after it (a heading with its first row, a last row with its totals). */
  keepWithNext?: boolean
}

export interface SectionLayoutParams {
  items: SectionItem[]
  /** Height of the column heads a section repeats when it continues on a new page, per section. */
  repeatHeights: number[]
  startPage: number
  startY: number
  laterTop: number
  bottom: number
  /** Space above each section. */
  gap: number
}

export interface SectionLayout {
  items: Placed[]
  /** A section's column heads, repeated where it continues onto a new page. */
  repeats: { section: number; page: number; y: number }[]
  pages: number
}

export function layoutSections(p: SectionLayoutParams): SectionLayout {
  const { items } = p
  let page = p.startPage
  let y = p.startY
  let pageStart = p.laterTop
  const placed: Placed[] = []
  const repeats: SectionLayout['repeats'] = []

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const firstOfSection = i === 0 || items[i - 1].section !== it.section
    if (firstOfSection && y > pageStart + 1e-9) y += p.gap

    // The item and everything chained to it by keepWithNext.
    let need = it.height
    for (let k = i; items[k]?.keepWithNext && items[k + 1]; k++) need += items[k + 1].height

    if (y + need > p.bottom + 1e-9 && y > pageStart + 1e-9) {
      page++
      y = p.laterTop
      if (!firstOfSection) {
        repeats.push({ section: it.section, page, y })
        y += p.repeatHeights[it.section] ?? 0
      }
      pageStart = y
    }
    placed.push({ page, y })
    y += it.height
  }
  return { items: placed, repeats, pages: page }
}
