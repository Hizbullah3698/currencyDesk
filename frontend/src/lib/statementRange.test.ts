import { describe, it, expect } from 'vitest'
import { statementRange } from './statementRange'
import { activityDate, customerLedger, stampTime } from './engine'
import type { Account, Activity } from './types'

// The customer statement's date range — AUDIT.md §3 #1.
//
// THE BUG THESE PIN. A statement's "To" date is a bare 'YYYY-MM-DD', and the page turned it into a
// timestamp with stampTime(), which parses a bare date as UTC MIDNIGHT. A deal struck on that same
// day is pinned by activityDate() to LOCAL NOON. Noon is after midnight in every timezone east of
// the Atlantic, so every deal dated on the "To" day fell outside the range and was dropped from the
// printed statement, the PDF and the Excel export — with a closing balance that was wrong by exactly
// those deals. The balance sheet and income statement never had this fault because they build their
// bounds through rangeBounds(), which ends a day at 23:59:59.999 local.
//
// The engine's own ledger tests never caught it because none of them placed a row ON the boundary
// day. These do.

const cust = (): Account =>
  ({
    id: 'c1',
    type: 'Customer',
    name: 'Boundary Test',
    notes: '',
    since: 'Sep 2026',
    createdAt: '2026-09-01T00:00:00.000Z',
    createdBy: 'test',
    updatedAt: '2026-09-01T00:00:00.000Z',
    updatedBy: 'test',
    receivable: 0,
    payable: 0,
    openingReceivable: 0,
    openingPayable: 0,
  }) as Account

const sale = (id: string, txnDate: string): Activity =>
  ({
    id,
    type: 'sale',
    currency: 'AED',
    txnDate,
    customerId: 'c1',
    customerName: 'Boundary Test',
    amount: 1000,
    rate: 80,
    pkrValue: 80_000,
    method: 'Credit',
    paidNow: 0,
    outstanding: 80_000,
    createdAt: txnDate + 'T09:00:00.000Z',
    createdBy: 'test',
    updatedAt: txnDate + 'T09:00:00.000Z',
    updatedBy: 'test',
  }) as Activity

describe('statementRange — the bounds a customer statement is cut on', () => {
  it('includes a deal struck ON the "To" date', () => {
    const range = statementRange('2026-09-01', '2026-09-30')
    const onLastDay = sale('last', '2026-09-30')
    // The deal's own reporting timestamp must sit inside the range, or the statement drops it.
    expect(stampTime(activityDate(onLastDay))).toBeLessThanOrEqual(range.toT!)
  })

  it('a statement for 1–30 September lists the 30 September deal and closes with it', () => {
    const activity = [sale('mid', '2026-09-15'), sale('last', '2026-09-30'), sale('after', '2026-10-01')]
    const l = customerLedger(cust(), activity, [], statementRange('2026-09-01', '2026-09-30'))

    expect(l.rows.map((r) => r.id)).toEqual(['mid', 'last'])
    // Two sales of 80,000 each — the closing figure printed on the document.
    expect(l.closing.net).toBe(160_000)
  })

  it('starts the range at the beginning of the "From" day, so a deal dated that day is inside it', () => {
    const range = statementRange('2026-09-15', '2026-09-30')
    const onFirstDay = sale('first', '2026-09-15')
    expect(stampTime(activityDate(onFirstDay))).toBeGreaterThanOrEqual(range.fromT!)
    const l = customerLedger(cust(), [sale('before', '2026-09-14'), onFirstDay], [], range)
    expect(l.rows.map((r) => r.id)).toEqual(['first'])
    expect(l.opening.net, 'the 14th is brought forward, not listed').toBe(80_000)
  })

  it('leaves a blank side unbounded', () => {
    expect(statementRange('', '').fromT).toBeUndefined()
    expect(statementRange('', '').toT).toBeUndefined()
    const l = customerLedger(cust(), [sale('a', '2026-09-30')], [], statementRange('', ''))
    expect(l.rows).toHaveLength(1)
  })
})
