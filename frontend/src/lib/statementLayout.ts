// ---------------------------------------------------------------------------
// Where each line of the statement goes, page by page
// ---------------------------------------------------------------------------
//
// Pure arithmetic on heights — no PDF, no fonts — so the page-break rules can be tested with plain
// numbers. The renderer measures each item, hands the heights here, and draws wherever this says.
//
// The rules (each one is a fault the old browser print had, or one the client's reference has):
//
//   1. THE TABLE HEADER REPEATS on every page. Every page's table starts one header row below the
//      page's top margin; `tableHead` is reserved there each time.
//   2. A DATE HEADER IS NEVER LEFT AT THE BOTTOM of a page with its entries on the next. It is kept
//      with the entry that follows it. (The opening-balance row is kept with the next row the same way.)
//   3. THE CLOSING BALANCE IS NEVER ALONE. The last `keepWithClosing` entries, their date header, and
//      the closing row are placed as ONE unit: if they do not all fit in what is left of the page, the
//      whole unit moves to the next page together. "The closing balance lands alone on page 2" was the
//      fault that started this.
//   3b. A DAY THAT CONTINUES OVER A PAGE BREAK repeats its date band at the top of the new page, marked
//      "continued". Otherwise the first rows of page 2 belong to no date at all and a reader cannot tell
//      which day they are looking at.
//   4. THE BOXES AFTER THE TABLE (currency position, pending cheques) are each kept whole. A box that
//      does not fit moves to a fresh page rather than splitting.

export type LayoutKind = 'opening' | 'date' | 'entry' | 'closing'

export interface LayoutItem {
  kind: LayoutKind
  height: number
}

export interface Placed {
  /** 1-based. */
  page: number
  /** Top of the item, mm from the top of the sheet. */
  y: number
}

export interface LayoutParams {
  /** The table, in order: opening, then date/entry runs, then closing last. */
  items: LayoutItem[]
  /** Heights of the boxes that follow the closing row, each kept whole. */
  blockHeights: number[]
  /** Where the table header goes on page 1 (below the document header and summary box). */
  firstTop: number
  /** Where the table header goes on pages 2 onward. */
  laterTop: number
  /** The lowest y a line may occupy. */
  bottom: number
  /** Height of the (repeated) table header row. */
  tableHead: number
  /** Entries kept together with the closing row. */
  keepWithClosing: number
  /** Space above each box. */
  blockGap: number
  /** Height of the repeated date band drawn where a day continues onto a new page. */
  bandHeight: number
}

/** A repeated date band: drawn at the top of `page`, standing in for the header of the day `itemIndex` belongs to. */
export interface ContinuedBand {
  page: number
  y: number
  itemIndex: number
}

export interface LayoutResult {
  pages: number
  items: Placed[]
  /** Where a day's date band is repeated because its entries carry on over a page break. */
  bands: ContinuedBand[]
  blocks: Placed[]
  /** Pages on which the table header is drawn. Every page that carries table rows. */
  tablePages: number[]
}

/** Index where the closing unit starts: the last N entries, plus the date header directly above them. */
export function closingUnitStart(items: LayoutItem[], keep: number): number {
  const closingIdx = items.length - 1
  let seen = 0
  let start = closingIdx
  for (let i = closingIdx - 1; i >= 0; i--) {
    start = i
    if (items[i].kind === 'entry') seen++
    if (items[i].kind === 'opening') break
    if (seen >= keep) {
      if (items[i - 1]?.kind === 'date') start = i - 1
      break
    }
  }
  return start
}

export function layoutStatement(p: LayoutParams): LayoutResult {
  const { items } = p
  const contentTop = (page: number) => (page === 1 ? p.firstTop : p.laterTop) + p.tableHead

  let page = 1
  let y = contentTop(1)
  const placed: Placed[] = []
  const bands: ContinuedBand[] = []
  const tablePages = new Set<number>([1])

  const unitStart = closingUnitStart(items, p.keepWithClosing)
  const unitHeight = items.slice(unitStart).reduce((s, it) => s + it.height, 0)

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    let need = it.height
    // Rule 2: a date header or the opening row travels with the row beneath it.
    if ((it.kind === 'date' || it.kind === 'opening') && items[i + 1]) need += items[i + 1].height
    // Rule 3: the closing unit is placed whole. (If it has to move and starts on an entry it gains the
    // repeated band of rule 3b on the fresh page, which always has room: the unit is only a few rows.)
    if (i === unitStart) need = unitHeight

    const atTop = y <= contentTop(page) + 1e-9
    if (y + need > p.bottom && !atTop) {
      page++
      y = contentTop(page)
      tablePages.add(page)
      // Rule 3b: a page that would open on an entry gets its day's band first.
      if (it.kind === 'entry') {
        bands.push({ page, y, itemIndex: i })
        y += p.bandHeight
      }
    }
    placed.push({ page, y })
    y += it.height
  }

  // Rule 4: each box whole, on a fresh page (no table header) if it does not fit.
  const blocks: Placed[] = []
  let blockPage = page
  for (const h of p.blockHeights) {
    const top = y + p.blockGap
    const fresh = blockPage === 1 ? p.firstTop : p.laterTop
    const atTopOfFresh = y <= fresh + 1e-9
    if (top + h > p.bottom && !atTopOfFresh) {
      blockPage++
      y = p.laterTop
      blocks.push({ page: blockPage, y })
      y += h
    } else {
      blocks.push({ page: blockPage, y: top })
      y = top + h
    }
  }

  return { pages: blockPage, items: placed, bands, blocks, tablePages: [...tablePages].sort((a, b) => a - b) }
}
