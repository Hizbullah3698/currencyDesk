import { describe, it, expect } from 'vitest'
import { closingUnitStart, layoutStatement, type LayoutItem, type LayoutParams } from './statementLayout'
import { STATEMENT_CONFIG as C } from './statementConfig'

// The real page geometry, so these tests describe the real document. firstTop is roughly where the
// header and summary box leave off (measured from a rendered page: ~66.5 mm).
const FIRST_TOP = 67
const LATER_TOP = C.margin.top + 9
const BOTTOM = C.page.height - C.margin.bottom
// The promise, stated here rather than read from the config it guards: three rows always travel with the closing balance.
const KEEP = 3

/** opening, then `days` date headers each followed by `perDay` entries, then closing. */
function table(days: number, perDay: number): LayoutItem[] {
  const items: LayoutItem[] = [{ kind: 'opening', height: C.row.opening }]
  for (let d = 0; d < days; d++) {
    items.push({ kind: 'date', height: C.row.date })
    for (let e = 0; e < perDay; e++) items.push({ kind: 'entry', height: C.row.entry })
  }
  items.push({ kind: 'closing', height: C.row.closing })
  return items
}

const params = (items: LayoutItem[], blockHeights: number[] = []): LayoutParams => ({
  items,
  blockHeights,
  firstTop: FIRST_TOP,
  laterTop: LATER_TOP,
  bottom: BOTTOM,
  tableHead: C.row.tableHead,
  keepWithClosing: KEEP,
  blockGap: 5,
  bandHeight: C.row.date,
})

describe('statement layout — page breaks', () => {
  it('puts a short statement on one page', () => {
    const r = layoutStatement(params(table(2, 3), [30, 40]))
    expect(r.pages).toBe(1)
    expect(r.tablePages).toEqual([1])
  })

  it("fits about forty rows on the first page, as the client's reference does", () => {
    // The exact largest number of entries, spread over 5 day-groups, whose whole table (opening row and
    // closing row included) stays on page 1. The reference prints 39 rows under 4 date bands on its page.
    const fitsOnOnePage = (entries: number) => {
      const items: LayoutItem[] = [{ kind: 'opening', height: C.row.opening }]
      for (let d = 0; d < 5; d++) {
        items.push({ kind: 'date', height: C.row.date })
        const inThisDay = Math.floor(entries / 5) + (d < entries % 5 ? 1 : 0)
        for (let e = 0; e < inThisDay; e++) items.push({ kind: 'entry', height: C.row.entry })
      }
      items.push({ kind: 'closing', height: C.row.closing })
      return layoutStatement(params(items)).pages === 1
    }
    let most = 0
    for (let n = 1; n <= 80; n++) if (fitsOnOnePage(n)) most = n
    expect(most, `page 1 holds ${most} entries under 5 date bands`).toBeGreaterThanOrEqual(39)
  })

  it('repeats the table header on every page that carries rows', () => {
    const r = layoutStatement(params(table(6, 20)))
    const pagesWithRows = [...new Set(r.items.map((p) => p.page))]
    expect(r.pages).toBeGreaterThan(1)
    expect(r.tablePages).toEqual(pagesWithRows.sort((a, b) => a - b))
  })

  it('starts each later page at the top margin plus the header, not where the last one ended', () => {
    const r = layoutStatement(params(table(6, 20)))
    const items = table(6, 20)
    const idx = r.items.findIndex((p) => p.page === 2)
    // A page that opens on an entry starts one date band lower (the repeated band); one that opens on a
    // date header starts right under the table header.
    const expected = LATER_TOP + C.row.tableHead + (items[idx].kind === 'entry' ? C.row.date : 0)
    expect(r.items[idx].y).toBeCloseTo(expected, 6)
  })

  it('never leaves a date header at the bottom of a page with its entries on the next', () => {
    for (let per = 1; per <= 9; per++) {
      const items = table(14, per)
      const r = layoutStatement(params(items))
      items.forEach((it, i) => {
        if (it.kind !== 'date') return
        expect(r.items[i].page, `date row ${i} (per=${per}) must share a page with the row below it`).toBe(r.items[i + 1].page)
      })
    }
  })

  it('never lets an item run past the bottom margin', () => {
    const items = table(10, 13)
    const r = layoutStatement(params(items, [45, 60]))
    items.forEach((it, i) => expect(r.items[i].y + it.height).toBeLessThanOrEqual(BOTTOM + 1e-9))
    const heights = [45, 60]
    r.blocks.forEach((b, i) => expect(b.y + heights[i]).toBeLessThanOrEqual(BOTTOM + 1e-9))
  })

  it('NEVER leaves the closing balance alone: it shares its page with the rows before it, at every table length', () => {
    // The fault that started this: "the closing balance lands alone on page 2". Sweep every length so a
    // boundary that happens to work for one size cannot hide one that does not.
    for (let n = 1; n <= 200; n++) {
      const items: LayoutItem[] = [{ kind: 'opening', height: C.row.opening }, { kind: 'date', height: C.row.date }]
      for (let e = 0; e < n; e++) items.push({ kind: 'entry', height: C.row.entry })
      items.push({ kind: 'closing', height: C.row.closing })
      const r = layoutStatement(params(items))
      const closingIdx = items.length - 1
      const closingPage = r.items[closingIdx].page
      const entriesWithIt = items.filter((it, i) => it.kind === 'entry' && r.items[i].page === closingPage).length
      expect(entriesWithIt, `n=${n}: closing on page ${closingPage} with only ${entriesWithIt} entries`).toBeGreaterThanOrEqual(Math.min(KEEP, n))
    }
  })

  it('moves the closing unit as a whole when it does not fit, rather than splitting it', () => {
    // Fill page 1 until only the closing row itself would still fit.
    const capacity = (BOTTOM - (FIRST_TOP + C.row.tableHead) - C.row.opening - C.row.date - C.row.closing) / C.row.entry
    const n = Math.floor(capacity)
    const items: LayoutItem[] = [{ kind: 'opening', height: C.row.opening }, { kind: 'date', height: C.row.date }]
    for (let e = 0; e < n; e++) items.push({ kind: 'entry', height: C.row.entry })
    items.push({ kind: 'closing', height: C.row.closing })
    const r = layoutStatement(params(items))
    const closingIdx = items.length - 1
    // The closing row and the entries kept with it are all on the same page...
    for (let k = 0; k <= KEEP; k++) expect(r.items[closingIdx - k].page).toBe(r.items[closingIdx].page)
    // ...which means the closing row is NOT the only thing on a page.
    const onItsPage = r.items.filter((p) => p.page === r.items[closingIdx].page).length
    expect(onItsPage).toBeGreaterThan(1)
  })

  it('keeps each box whole, moving a box that does not fit to a fresh page', () => {
    const items = table(1, 3)
    // Boxes tall enough that the second cannot follow the first on the same page.
    const r = layoutStatement(params(items, [120, 150]))
    expect(r.blocks[0].page).toBe(1)
    expect(r.blocks[1].page).toBe(2)
    expect(r.blocks[1].y).toBeCloseTo(LATER_TOP, 6)
    expect(r.pages).toBe(2)
  })

  it('finds the closing unit: the last N entries and the date header above them', () => {
    const items = table(3, 4)
    const start = closingUnitStart(items, 3)
    expect(items[start].kind).toBe('entry')
    // Last 3 entries of the last day: one entry above them belongs to the same day, so the date header is not pulled in.
    const closingIdx = items.length - 1
    expect(closingIdx - start).toBe(3)

    // When the unit starts exactly at the first entry of a day, that day's header comes with it.
    const items2 = table(2, 3)
    const start2 = closingUnitStart(items2, 3)
    expect(items2[start2].kind).toBe('date')
  })

  it('repeats the date band of a day that carries on over a page break, marked continued', () => {
    // One long day: it must break mid-day, so the second page opens on an entry that belongs to it.
    const items: LayoutItem[] = [{ kind: 'opening', height: C.row.opening }, { kind: 'date', height: C.row.date }]
    for (let e = 0; e < 70; e++) items.push({ kind: 'entry', height: C.row.entry })
    items.push({ kind: 'closing', height: C.row.closing })
    const r = layoutStatement(params(items))
    expect(r.pages).toBeGreaterThan(1)
    expect(r.bands.length).toBe(r.pages - 1)
    for (const b of r.bands) {
      // The band sits at the top of its page, and the entry it stands for starts directly beneath it.
      expect(b.y).toBeCloseTo(LATER_TOP + C.row.tableHead, 6)
      expect(r.items[b.itemIndex].page).toBe(b.page)
      expect(r.items[b.itemIndex].y).toBeCloseTo(b.y + C.row.date, 6)
    }
  })

  it('does not add a band when a page opens on a date header — that header IS the band', () => {
    const r = layoutStatement(params(table(14, 6)))
    const items = table(14, 6)
    for (const b of r.bands) expect(items[b.itemIndex].kind).toBe('entry')
    // Every page that opens on a date header has no band drawn above it.
    const firstOnPage = (page: number) => r.items.findIndex((p) => p.page === page)
    for (let pg = 2; pg <= r.pages; pg++) {
      const idx = firstOnPage(pg)
      if (idx >= 0 && items[idx].kind === 'date') expect(r.bands.some((b) => b.page === pg)).toBe(false)
    }
  })
})
