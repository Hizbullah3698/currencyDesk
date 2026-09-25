import { describe, it, expect } from 'vitest'
import { closingUnitStart, layoutLedger, layoutSections, type LedgerItem, type LedgerLayoutParams, type SectionItem } from './statementLayout'
import { STATEMENT_CONFIG as C } from './statementConfig'

// Plain numbers in the region of the real page: the page-1 header ends about 84 mm down, later pages about 23 mm.
const FIRST_TOP = 84
const LATER_TOP = 23
const BOTTOM = C.page.height - C.margin.bottom
const CONT = C.row.continuity
const HEAD = C.row.tableHead
// The promise, stated here rather than read from the config it guards: three rows always travel with the closing balance.
const KEEP = 3
const ONE = 7.1 // a one-line row
const TWO = 10.9 // a two-line row

/** opening, `n` entries (alternating one- and two-line, or the heights given), totals, closing. */
function ledger(n: number, height?: (i: number) => number): LedgerItem[] {
  const items: LedgerItem[] = [{ kind: 'opening', height: ONE }]
  for (let i = 0; i < n; i++) items.push({ kind: 'entry', height: height ? height(i) : i % 2 ? ONE : TWO })
  items.push({ kind: 'totals', height: C.row.totals })
  items.push({ kind: 'closing', height: 11 })
  return items
}

const params = (items: LedgerItem[]): LedgerLayoutParams => ({
  items,
  firstTop: FIRST_TOP,
  laterTop: LATER_TOP,
  bottom: BOTTOM,
  tableHead: HEAD,
  continuity: CONT,
  keepWithClosing: KEEP,
})

describe('statement layout — the ledger', () => {
  it('puts a short statement on one page with no continuity rows', () => {
    const r = layoutLedger(params(ledger(5)))
    expect(r.endPage).toBe(1)
    expect(r.tablePages).toEqual([1])
    expect(r.carried).toEqual([])
    expect(r.brought).toEqual([])
  })

  it('never lets a row, or a carried-forward row, run past the bottom margin', () => {
    for (const n of [10, 30, 60, 120, 200]) {
      const items = ledger(n)
      const r = layoutLedger(params(items))
      items.forEach((it, i) => expect(r.items[i].y + it.height, `n=${n} item ${i}`).toBeLessThanOrEqual(BOTTOM + 1e-9))
      for (const c of r.carried) expect(c.y + CONT, `n=${n} carried on page ${c.page}`).toBeLessThanOrEqual(BOTTOM + 1e-9)
    }
  })

  it('ends every page it leaves with "carried forward" and starts the next with "brought forward", after the same row', () => {
    const items = ledger(120)
    const r = layoutLedger(params(items))
    expect(r.endPage).toBeGreaterThan(2)
    expect(r.carried.length).toBe(r.endPage - 1)
    expect(r.brought.length).toBe(r.endPage - 1)
    r.carried.forEach((c, k) => {
      const b = r.brought[k]
      expect(b.page).toBe(c.page + 1)
      // Both stand for the balance after the SAME item — the last one on the page being left.
      expect(b.afterItem).toBe(c.afterItem)
      expect(r.items[c.afterItem].page).toBe(c.page)
      expect(r.items[c.afterItem + 1].page).toBe(b.page)
      // Carried sits directly under that last row; brought sits directly under the repeated table header.
      expect(c.y).toBeCloseTo(r.items[c.afterItem].y + items[c.afterItem].height, 6)
      expect(b.y).toBeCloseTo(LATER_TOP + HEAD, 6)
      expect(r.items[c.afterItem + 1].y).toBeCloseTo(b.y + CONT, 6)
    })
  })

  it('repeats the table header on every page that carries rows', () => {
    const r = layoutLedger(params(ledger(150)))
    const pagesWithRows = [...new Set(r.items.map((p) => p.page))].sort((a, b) => a - b)
    expect(r.tablePages).toEqual(pagesWithRows)
  })

  it('never splits a row: every row sits wholly on one page, whatever mix of heights', () => {
    const items = ledger(90, (i) => [ONE, TWO, 14.7, ONE, 18.5][i % 5])
    const r = layoutLedger(params(items))
    items.forEach((it, i) => {
      const top = r.items[i].page === 1 ? FIRST_TOP + HEAD : LATER_TOP + HEAD
      expect(r.items[i].y).toBeGreaterThanOrEqual(top - 1e-9)
      expect(r.items[i].y + it.height).toBeLessThanOrEqual(BOTTOM + 1e-9)
    })
  })

  it('NEVER leaves the closing balance alone: totals and closing share a page with the last three entries, at every length', () => {
    for (let n = 0; n <= 160; n++) {
      const items = ledger(n)
      const r = layoutLedger(params(items))
      const closing = items.length - 1
      const totals = closing - 1
      const page = r.items[closing].page
      expect(r.items[totals].page, `n=${n}: totals and closing apart`).toBe(page)
      const entriesWithIt = items.filter((it, i) => it.kind === 'entry' && r.items[i].page === page).length
      expect(entriesWithIt, `n=${n}: closing on page ${page} with ${entriesWithIt} entries`).toBeGreaterThanOrEqual(Math.min(KEEP, n))
    }
  })

  it('keeps the opening row with the first entry', () => {
    const r = layoutLedger(params(ledger(40)))
    expect(r.items[0].page).toBe(r.items[1].page)
  })

  it('finds the closing unit: the last N entries, or everything after the opening row when there are fewer', () => {
    const items = ledger(10)
    expect(closingUnitStart(items, 3)).toBe(items.length - 2 - 3)
    expect(closingUnitStart(ledger(2), 3)).toBe(1)
    expect(closingUnitStart(ledger(0), 3)).toBe(1)
  })
})

describe('statement layout — the sections after the ledger', () => {
  const section = (s: number, rows: number, withTotals = false): SectionItem[] => [
    { section: s, height: 24, keepWithNext: true },
    ...Array.from({ length: rows }, (_, i) => ({ section: s, height: ONE, keepWithNext: withTotals && i === rows - 1 })),
    ...(withTotals ? [{ section: s, height: 7.4, keepWithNext: true }, { section: s, height: 7.4 }] : []),
  ]
  const run = (items: SectionItem[], startY: number, startPage = 3) =>
    layoutSections({ items, repeatHeights: [HEAD, HEAD], startPage, startY, laterTop: LATER_TOP, bottom: BOTTOM, gap: 8 })

  it('follows the ledger on the same page when there is room, instead of forcing a new page', () => {
    const r = run([...section(0, 2), ...section(1, 2, true)], 150)
    expect(r.pages).toBe(3)
    expect(r.items[0]).toEqual({ page: 3, y: 158 })
  })

  it('never orphans a heading: it moves with its first row', () => {
    for (let startY = 200; startY < BOTTOM; startY += 0.5) {
      const items = [...section(0, 3), ...section(1, 2, true)]
      const r = run(items, startY)
      items.forEach((it, i) => {
        if (it.keepWithNext) expect(r.items[i + 1].page, `startY=${startY} item ${i}`).toBe(r.items[i].page)
      })
    }
  })

  it('keeps a section\'s last row with its totals, and both totals together', () => {
    const items = section(0, 4, true)
    for (let startY = 200; startY < BOTTOM; startY += 0.5) {
      const r = run(items, startY)
      const last = items.length - 1
      expect(r.items[last].page).toBe(r.items[last - 1].page)
      expect(r.items[last - 1].page).toBe(r.items[last - 2].page)
    }
  })

  it('repeats the column heads when a long section runs onto a new page, and stays inside the margins', () => {
    const items = section(0, 60, true)
    const r = run(items, 200)
    expect(r.pages).toBeGreaterThan(3)
    expect(r.repeats.length).toBe(r.pages - 3)
    for (const rep of r.repeats) {
      expect(rep.y).toBeCloseTo(LATER_TOP, 6)
      const first = r.items.findIndex((p) => p.page === rep.page)
      expect(r.items[first].y).toBeCloseTo(LATER_TOP + HEAD, 6)
    }
    items.forEach((it, i) => expect(r.items[i].y + it.height).toBeLessThanOrEqual(BOTTOM + 1e-9))
  })
})
