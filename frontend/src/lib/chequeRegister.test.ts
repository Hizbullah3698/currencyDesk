import { describe, it, expect } from 'vitest'
import { chequeLegs, chequeRegister, receivedDate } from './chequeRegister'
import type { Account, Activity, Cheque } from './types'

// The cheque register's Dr/Cr rules are the point of the screen, and a frontend test runs with no
// jsdom — so the logic lives in lib/ where it can be tested at all. These pin it against the
// backend's chequeClearingSides, which is what actually posts when a cheque clears: get these out
// of step and the register would confidently describe a posting the books never make.

const accounts: Account[] = [
  { id: 'bank', type: 'Bank', name: 'Meezan Bank — Current' } as Account,
  { id: 'cust1', type: 'Customer', name: 'Ahmed Khan' } as Account,
]

function cheque(over: Partial<Cheque> = {}): Cheque {
  return {
    id: 'q1',
    direction: 'Inward',
    number: '1001',
    party: 'Ahmed Khan',
    customerId: 'cust1',
    bank: 'HBL',
    bankAccountId: 'bank',
    amount: 50_000,
    due: '2026-10-01',
    status: 'Pending',
    ledgerApplied: false,
    history: [],
    createdAt: '2026-09-20T08:00:00.000Z',
    createdBy: 'Admin',
    updatedAt: '2026-09-20T08:00:00.000Z',
    updatedBy: 'Admin',
    ...over,
  } as Cheque
}

function activity(over: Partial<Activity> = {}): Activity {
  return {
    id: 'a1',
    type: 'receive',
    customerId: 'cust1',
    customerName: 'Ahmed Khan',
    amount: 50_000,
    pkrValue: 50_000,
    method: 'Cheque',
    chequeHeld: true,
    chequeId: 'q1',
    createdAt: '2026-09-20T08:00:00.000Z',
    createdBy: 'Admin',
    updatedAt: '2026-09-20T08:00:00.000Z',
    updatedBy: 'Admin',
    ...over,
  } as Activity
}

describe('chequeLegs — derived, never chosen', () => {
  it('debits the bank and credits the customer on an inward cheque', () => {
    // Money arriving: the desk's bank gains, the customer owes that much less.
    expect(chequeLegs(cheque({ direction: 'Inward' }), accounts)).toEqual({
      debitAccount: 'Meezan Bank — Current',
      creditAccount: 'Ahmed Khan',
    })
  })

  it('is the exact mirror on an outward cheque', () => {
    expect(chequeLegs(cheque({ direction: 'Outward' }), accounts)).toEqual({
      debitAccount: 'Ahmed Khan',
      creditAccount: 'Meezan Bank — Current',
    })
  })

  it('resolves names, not ids — this is a register to read', () => {
    const legs = chequeLegs(cheque(), accounts)
    expect(legs.debitAccount).not.toBe('bank')
    expect(legs.creditAccount).not.toBe('cust1')
  })

  it('shows a dash rather than a blank when an account cannot be resolved', () => {
    // customer_id is nullable, and an account could in principle be gone. A dash says "nothing
    // here"; an empty cell reads as a rendering bug.
    expect(chequeLegs(cheque({ customerId: null }), accounts).creditAccount).toBe('—')
    expect(chequeLegs(cheque({ bankAccountId: 'ghost' }), accounts).debitAccount).toBe('—')
  })
})

describe('receivedDate — the day it was handed over, not the day it was keyed in', () => {
  it('reads the transaction date of the payment behind the cheque', () => {
    // The whole reason this is not just `cheque.createdAt`: a cheque taken on the 14th and entered
    // on the 20th belongs under the 14th on a register listed by received date.
    const q = cheque({ createdAt: '2026-09-20T08:00:00.000Z' })
    const behind = activity({ chequeId: 'q1', txnDate: '2026-09-14' })
    expect(receivedDate(q, [behind]).slice(0, 10)).toBe('2026-09-14')
  })

  it('falls back to the cheque own timestamp when no payment points at it', () => {
    expect(receivedDate(cheque(), [])).toBe('2026-09-20T08:00:00.000Z')
  })
})

describe('chequeRegister — grouped by day, newest first', () => {
  it('groups cheques received on the same day and totals them', () => {
    const rows = chequeRegister(
      [cheque({ id: 'q1', number: 'A', amount: 10_000 }), cheque({ id: 'q2', number: 'B', amount: 15_000 })],
      [activity({ id: 'a1', chequeId: 'q1', txnDate: '2026-09-14' }), activity({ id: 'a2', chequeId: 'q2', txnDate: '2026-09-14' })],
      accounts,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('2026-09-14')
    expect(rows[0].rows).toHaveLength(2)
    expect(rows[0].total, 'the day totals what it holds').toBe(25_000)
  })

  it('puts the most recent day first', () => {
    const rows = chequeRegister(
      [cheque({ id: 'q1', number: 'A' }), cheque({ id: 'q2', number: 'B' })],
      [activity({ id: 'a1', chequeId: 'q1', txnDate: '2026-09-01' }), activity({ id: 'a2', chequeId: 'q2', txnDate: '2026-09-18' })],
      accounts,
    )
    expect(rows.map((d) => d.date)).toEqual(['2026-09-18', '2026-09-01'])
  })

  it('keeps the cheque date separate from the received date', () => {
    // Two different dates that a register must not conflate: when it arrived vs what is written
    // on it. A post-dated cheque is the ordinary case, not an edge one.
    const rows = chequeRegister([cheque({ due: '2026-12-25' })], [activity({ txnDate: '2026-09-14' })], accounts)
    expect(rows[0].date, 'grouped by received').toBe('2026-09-14')
    expect(rows[0].rows[0].chequeDate, 'and still carries its own date').toBe('2026-12-25')
  })

  it('lists a cheque whatever its status, including cancelled', () => {
    // A register is a record of what was entered, not of what is outstanding — the Cheques page is
    // the one that tracks live ones.
    const rows = chequeRegister(
      [cheque({ id: 'q1', status: 'Cleared' }), cheque({ id: 'q2', status: 'Cancelled' })],
      [],
      accounts,
    )
    expect(rows.flatMap((d) => d.rows)).toHaveLength(2)
  })
})
