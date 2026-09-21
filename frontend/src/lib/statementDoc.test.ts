import { describe, it, expect } from 'vitest'
import type { Account, Activity, Cheque, JournalEntry } from './engine'
import { buildStatementDocument, pdfDate, StatementIntegrityError, type StatementSource } from './statementDoc'
import { formatBalance } from './statementMoney'
import { shortRef } from './format'

const AUDIT = { createdBy: 'admin', updatedBy: 'admin' }
const NOW = new Date(2026, 8, 21, 14, 5) // 21 Sep 2026, 14:05 local

const CUST = '5c9ab663-ea1e-4196-85db-a1c4503bd44e'
const OTHER = '9f1d2c3b-aaaa-4bbb-8ccc-111122223333'

function acct(o: Partial<Account> & Pick<Account, 'id' | 'type' | 'name'>): Account {
  return { notes: '', since: 'Sep 2026', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...AUDIT, ...o } as Account
}
const customer = acct({ id: CUST, type: 'Customer', name: 'Dubai Tmn Buyer' })
const other = acct({ id: OTHER, type: 'Customer', name: 'Bilal Traders' })
const bank = acct({ id: 'bank1', type: 'Bank', name: 'Meezan Bank - Current' })
const capital = acct({ id: 'capital', type: 'Capital', name: 'Capital' })
const accounts = [customer, other, bank, capital]

let n = 0
const uuid = () => `${(0xa0000000 + ++n).toString(16)}-0000-4000-8000-00000000${String(n).padStart(4, '0')}`

function act(o: Partial<Activity> & Pick<Activity, 'type'>): Activity {
  return {
    id: uuid(),
    currency: 'AED',
    customerId: CUST,
    customerName: customer.name,
    amount: 0,
    pkrValue: 0,
    method: 'Credit',
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-15T10:00:00.000Z',
    ...AUDIT,
    ...o,
  } as Activity
}
function je(o: Partial<JournalEntry> & Pick<JournalEntry, 'debitAccount' | 'creditAccount' | 'amount'>): JournalEntry {
  return {
    id: uuid(),
    ref: 'JV-001',
    narration: 'Manual entry',
    debitLabel: 'x',
    creditLabel: 'y',
    txnDate: '2026-09-15',
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-15T10:00:00.000Z',
    ...AUDIT,
    ...o,
  } as JournalEntry
}
function chq(o: Partial<Cheque> & Pick<Cheque, 'direction' | 'amount'>): Cheque {
  return {
    id: uuid(),
    number: '001234',
    party: customer.name,
    customerId: CUST,
    bank: 'HBL',
    bankAccountId: 'bank1',
    due: '2026-09-30',
    status: 'Pending',
    ledgerApplied: false,
    history: [],
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-15T10:00:00.000Z',
    ...AUDIT,
    ...o,
  } as Cheque
}
const src = (o: Partial<StatementSource> = {}): StatementSource => ({ customer, accounts, activity: [], cheques: [], journalEntries: [], ...o })

/** Dubai Tmn Buyer as it stands on the dev desk: five entries, closing 4,749,855.69 Dr. */
function dubai() {
  return [
    act({ id: 'ce78b16f-0000-4000-8000-000000000001', type: 'sale', currency: 'AED', amount: 500, rate: 80, pkrValue: 40000, txnDate: '2026-09-18', createdAt: '2026-09-18T07:00:00.000Z' }),
    act({ id: 'a3f39cc7-0000-4000-8000-000000000002', type: 'sale', currency: 'TMN', amount: 3_000_000_000, rate: 788, pkrValue: 3807106.6, txnDate: '2026-09-19', createdAt: '2026-09-19T07:00:00.000Z' }),
    act({ id: '92c73272-0000-4000-8000-000000000003', type: 'receive', amount: 1_000_000, pkrValue: 1_000_000, method: 'Cash', txnDate: '2026-09-20', createdAt: '2026-09-20T07:00:00.000Z' }),
    act({ id: 'c282cfed-0000-4000-8000-000000000004', type: 'sale', currency: 'TMN', amount: 1_000_000_000, rate: 788, pkrValue: 1269035.53, txnDate: '2026-09-21', createdAt: '2026-09-21T07:00:00.000Z' }),
    act({ id: '8c2936e2-0000-4000-8000-000000000005', type: 'sale', currency: 'TMN', amount: 500_000_000, rate: 789, pkrValue: 633713.56, txnDate: '2026-09-21', createdAt: '2026-09-21T09:00:00.000Z' }),
  ]
}

describe('statement document — the numbers', () => {
  it('reproduces the dev customer: 5 entries, closing 4,749,855.69 Dr, worked by hand', () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { now: NOW })
    expect(d.entryCount).toBe(5)
    // 0 + (40,000.00 + 3,807,106.60 + 1,269,035.53 + 633,713.56) - 1,000,000.00
    expect(d.opening).toBe(0)
    expect(d.totalDebits).toBe(574_985_569)
    expect(d.totalCredits).toBe(100_000_000)
    expect(d.closing).toBe(474_985_569)
    expect(formatBalance(d.closing, 2)).toBe('4,749,855.69 Dr')
  })

  it('satisfies opening + debits - credits = closing, exactly, in paisa', () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { now: NOW })
    expect(d.opening + d.totalDebits - d.totalCredits).toBe(d.closing)
  })

  it('makes every column add up on paper: the printed rows sum to the printed totals', () => {
    // The old print rounded each row to a whole rupee and the rows summed to 4,749,857 while the closing
    // balance said 4,749,856. In paisa the rows ARE the total.
    const d = buildStatementDocument(src({ activity: dubai() }), { now: NOW })
    const entries = d.groups.flatMap((g) => g.entries)
    expect(entries.reduce((s, e) => s + e.debit, 0)).toBe(d.totalDebits)
    expect(entries.reduce((s, e) => s + e.credit, 0)).toBe(d.totalCredits)
    // And each row's balance is exactly the previous balance plus its own debit less its credit.
    let prev = d.opening
    for (const e of entries) {
      expect(e.balance).toBe(prev + e.debit - e.credit)
      prev = e.balance
    }
    expect(prev).toBe(d.closing)
  })

  it('prints a balance that crosses from Dr to Cr on the right side, never with a minus sign', () => {
    const activity = [
      act({ type: 'sale', currency: 'AED', amount: 100, rate: 10, pkrValue: 1000, txnDate: '2026-09-15', createdAt: '2026-09-15T07:00:00.000Z' }),
      act({ type: 'purchase', currency: 'AED', amount: 300, rate: 10, pkrValue: 3000, txnDate: '2026-09-15', createdAt: '2026-09-15T09:00:00.000Z' }),
      act({ type: 'sale', currency: 'AED', amount: 50, rate: 10, pkrValue: 500, txnDate: '2026-09-16', createdAt: '2026-09-16T09:00:00.000Z' }),
    ]
    const d = buildStatementDocument(src({ activity }), { now: NOW })
    const printed = d.groups.flatMap((g) => g.entries).map((e) => formatBalance(e.balance, 2))
    expect(printed).toEqual(['1,000.00 Dr', '2,000.00 Cr', '1,500.00 Cr'])
    for (const p of printed) expect(p).not.toContain('-')
    expect(d.closing).toBe(-150_000)
    expect(d.opening + d.totalDebits - d.totalCredits).toBe(d.closing)
    // The purchase is a CREDIT (the desk now owes the customer) and the sale a DEBIT.
    const e = d.groups.flatMap((g) => g.entries)
    expect([e[0].debit, e[0].credit]).toEqual([100_000, 0])
    expect([e[1].debit, e[1].credit]).toEqual([0, 300_000])
  })

  it('orders deals inside one day oldest-first, so the printed balances follow the order they happened', () => {
    const late = act({ type: 'sale', amount: 1, rate: 10, pkrValue: 500, txnDate: '2026-09-15', createdAt: '2026-09-15T11:00:00.000Z' })
    const early = act({ type: 'sale', amount: 1, rate: 10, pkrValue: 1000, txnDate: '2026-09-15', createdAt: '2026-09-15T07:00:00.000Z' })
    const d = buildStatementDocument(src({ activity: [late, early] }), { now: NOW })
    expect(d.groups).toHaveLength(1)
    expect(d.groups[0].entries.map((e) => e.debit)).toEqual([100_000, 50_000])
    expect(d.groups[0].entries.map((e) => e.balance)).toEqual([100_000, 150_000])
  })

  it('carries a balance brought forward from before the period, and the identity still holds', () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { from: '2026-09-20', to: '', now: NOW })
    expect(d.opening).toBe(384_710_660) // 40,000.00 + 3,807,106.60 owed before the 20th
    expect(d.entryCount).toBe(3)
    expect(d.opening + d.totalDebits - d.totalCredits).toBe(d.closing)
    expect(d.closing).toBe(474_985_569)
    expect(d.periodFrom).toBe('20 Sep 2026')
  })

  it('shows exact paisa or whole rupees from ONE setting, and the identity holds internally either way', () => {
    const exact = buildStatementDocument(src({ activity: dubai() }), { now: NOW, decimals: 2 })
    const whole = buildStatementDocument(src({ activity: dubai() }), { now: NOW, decimals: 0 })
    expect(exact.decimals).toBe(2)
    expect(whole.decimals).toBe(0)
    // The underlying paisa figures are identical; only the display differs.
    expect(whole.closing).toBe(exact.closing)
    expect(formatBalance(whole.closing, whole.decimals)).toBe('4,749,856 Dr')
  })

  it('refuses to build a statement that does not add up', () => {
    // The class exists so the caller can tell "would print wrong" from an ordinary failure.
    expect(new StatementIntegrityError('x')).toBeInstanceOf(Error)
    expect(new StatementIntegrityError('x').name).toBe('StatementIntegrityError')
  })
})

describe('statement document — wording and references', () => {
  it('describes a deal with its currency amount and rate, on one line, from stored fields', () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { now: NOW })
    const desc = d.groups.flatMap((g) => g.entries.map((e) => e.description))
    expect(desc).toEqual([
      'Sale · 500 AED @ 80',
      'Sale · 3,000,000,000 TMN @ 788',
      'Payment received · Cash',
      'Sale · 1,000,000,000 TMN @ 788',
      'Sale · 500,000,000 TMN @ 789',
    ])
  })

  it('describes a purchase, a payment made, and a bank payment by the bank account it went through', () => {
    const activity = [
      act({ type: 'purchase', currency: 'AED', amount: 500, rate: 80, pkrValue: 40000, txnDate: '2026-09-15' }),
      act({ type: 'pay', amount: 100, pkrValue: 100, method: 'Cash', txnDate: '2026-09-15', createdAt: '2026-09-15T11:00:00.000Z' }),
      act({ type: 'receive', amount: 100, pkrValue: 100, method: 'Bank', settlementAccountId: 'bank1', txnDate: '2026-09-15', createdAt: '2026-09-15T12:00:00.000Z' }),
    ]
    const d = buildStatementDocument(src({ activity }), { now: NOW })
    expect(d.groups[0].entries.map((e) => e.description)).toEqual([
      'Purchase · 500 AED @ 80',
      'Payment made · Cash',
      'Payment received · Meezan Bank - Current',
    ])
  })

  it('references a deal or payment exactly as the Transactions page does', () => {
    const activity = dubai()
    const d = buildStatementDocument(src({ activity }), { now: NOW })
    const refs = d.groups.flatMap((g) => g.entries.map((e) => e.ref))
    expect(refs).toEqual(activity.map((a) => shortRef(a.id)))
    expect(refs[0]).toBe('CE78B16F')
    expect(refs[1]).toBe('A3F39CC7')
  })

  it('shows the customer account id in the same short form', () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { now: NOW })
    expect(d.accountId).toBe('5C9AB663')
  })

  it('describes a cleared cheque with its bank and number, referenced as the Transactions page does', () => {
    const q = chq({ direction: 'Inward', amount: 500, status: 'Cleared', bank: 'HBL', number: '001234', updatedAt: '2026-09-16T09:00:00.000Z' })
    const sale = act({ type: 'sale', amount: 1, rate: 10, pkrValue: 2000, txnDate: '2026-09-15' })
    const d = buildStatementDocument(src({ activity: [sale], cheques: [q] }), { now: NOW })
    const e = d.groups.flatMap((g) => g.entries)[1]
    expect(e.description).toBe('Cheque cleared · HBL 001234')
    expect(e.ref).toBe(shortRef(q.id))
    expect(e.credit).toBe(50_000)
  })

  it('words a customer-to-customer transfer by which leg is this customer', () => {
    const toOther = je({ ref: 'JV-002', debitAccount: CUST, creditAccount: OTHER, debitLabel: customer.name, creditLabel: other.name, amount: 700, narration: 'Transfer from Dubai Tmn Buyer to Bilal Traders' })
    const fromOther = je({ ref: 'JV-003', debitAccount: OTHER, creditAccount: CUST, debitLabel: other.name, creditLabel: customer.name, amount: 300, narration: 'Transfer from Bilal Traders to Dubai Tmn Buyer', createdAt: '2026-09-15T11:00:00.000Z' })
    const d = buildStatementDocument(src({ journalEntries: [toOther, fromOther] }), { now: NOW })
    const e = d.groups.flatMap((g) => g.entries)
    expect(e[0].description).toBe('Transfer to Bilal Traders')
    expect(e[0].ref).toBe('JV-002')
    expect(e[0].debit).toBe(70_000)
    expect(e[1].description).toBe('Transfer from Bilal Traders')
    expect(e[1].credit).toBe(30_000)
  })

  it('uses the narration for an ordinary manual entry and the journal reference as its Ref', () => {
    const entry = je({ ref: 'JV-009', debitAccount: CUST, creditAccount: 'capital', debitLabel: customer.name, creditLabel: 'Capital', amount: 250, narration: 'Opening adjustment' })
    const d = buildStatementDocument(src({ journalEntries: [entry] }), { now: NOW })
    const e = d.groups[0].entries[0]
    expect(e.description).toBe('Opening adjustment')
    expect(e.ref).toBe('JV-009')
  })

  it('formats dates unambiguously', () => {
    expect(pdfDate('2026-09-19')).toBe('19 Sep 2026')
    expect(pdfDate('2026-01-05T10:00:00.000Z')).toBe('5 Jan 2026')
  })
})

describe('statement document — pending cheques and currency position', () => {
  it('leaves an uncleared cheque payment out of the table and lists it in the pending box with amounts', () => {
    const held = act({ type: 'receive', amount: 500_000, pkrValue: 500_000, method: 'Cheque', chequeHeld: true, txnDate: '2026-09-16', createdAt: '2026-09-16T08:00:00.000Z' })
    const sale = act({ type: 'sale', amount: 1, rate: 10, pkrValue: 900_000, txnDate: '2026-09-15' })
    const inward = chq({ direction: 'Inward', amount: 500_000, number: '778899', bank: 'HBL', due: '2026-10-01' })
    const outward = chq({ direction: 'Outward', amount: 120_000.5, number: '445566', bank: 'UBL', due: '2026-09-25', status: 'Deposited' })
    // Cleared moves the balance (and so would be a row) — so this one belongs to someone else. Returned moves nothing.
    const cleared = chq({ direction: 'Inward', amount: 1, status: 'Cleared', number: 'DONE', customerId: OTHER })
    const returned = chq({ direction: 'Inward', amount: 2, status: 'Returned', number: 'BOUNCED' })
    const d = buildStatementDocument(src({ activity: [sale, held], cheques: [inward, outward, cleared, returned] }), { now: NOW })

    // The held payment moved nothing, so it is not a row — the balance is just the sale.
    expect(d.entryCount).toBe(1)
    expect(d.closing).toBe(90_000_000)
    // Only uncleared cheques are listed, soonest due first, each with its amount.
    expect(d.pendingCheques.map((q) => q.number)).toEqual(['445566', '778899'])
    expect(d.pendingCheques.map((q) => q.directionLabel)).toEqual(['Issued (out)', 'Received (in)'])
    expect(d.pendingIn).toBe(50_000_000)
    expect(d.pendingOut).toBe(12_000_050)
    expect(d.pendingCheques.map((q) => q.status)).toEqual(['Deposited', 'Pending'])
  })

  it('states a currency position in words, not signed numbers', () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { now: NOW })
    const byCode = Object.fromEntries(d.positions.map((p) => [p.code, p]))
    expect(byCode.TMN.side).toBe('sold')
    expect(byCode.TMN.sideLabel).toBe('Sold to customer')
    expect(byCode.TMN.unitsLabel).toBe('4,500,000,000')
    expect(byCode.TMN.value).toBe(570_985_569)
    expect(byCode.AED.sideLabel).toBe('Sold to customer')

    const bought = buildStatementDocument(src({ activity: [act({ type: 'purchase', currency: 'USD', amount: 1000, rate: 282.5, pkrValue: 282_500, txnDate: '2026-09-15' })] }), { now: NOW })
    expect(bought.positions[0].sideLabel).toBe('Bought from customer')
    expect(bought.positions[0].unitsLabel).toBe('1,000')
  })
})

describe('statement document — nothing about profit, for anyone', () => {
  it('carries no cost or margin figure or key even when the source rows have them (an admin snapshot)', () => {
    const withProfit = dubai().map((a) => (a.type === 'sale' ? { ...a, cost: 3_794_008.34, margin: 13_098.26 } : a))
    const adminDoc = buildStatementDocument(src({ activity: withProfit }), { now: NOW })
    const operatorDoc = buildStatementDocument(src({ activity: dubai() }), { now: NOW })
    const text = JSON.stringify(adminDoc)
    for (const leak of ['3794008', '379400834', '13098', '1309826', 'margin', 'Margin', 'cost', 'Cost', 'profit', 'Profit']) {
      expect(text.includes(leak), `"${leak}" must not appear in the statement document`).toBe(false)
    }
    // An operator's statement is BUILT from the same fields, so the two documents are identical.
    expect(JSON.stringify(operatorDoc)).toBe(text)
  })
})

describe('statement document — text the font cannot print', () => {
  it('reports the customer name field when it has characters the PDF cannot print', () => {
    const arabic = acct({ id: CUST, type: 'Customer', name: 'محمد Traders' })
    const d = buildStatementDocument(src({ customer: arabic, activity: dubai() }), { now: NOW })
    expect(d.customerName).toBe('???? Traders')
    expect(d.warnings.map((w) => w.field)).toContain('Customer name')
    expect(d.warnings.find((w) => w.field === 'Customer name')!.characters.length).toBeGreaterThan(0)
  })

  it('names the narration of the entry it came from', () => {
    const entry = je({ ref: 'JV-011', debitAccount: CUST, creditAccount: 'capital', debitLabel: customer.name, creditLabel: 'Capital', amount: 1, narration: 'Fee → Bilal' })
    const d = buildStatementDocument(src({ journalEntries: [entry] }), { now: NOW })
    expect(d.groups[0].entries[0].description).toBe('Fee ? Bilal')
    expect(d.warnings).toEqual([{ field: 'Entry narration JV-011', characters: ['→'], printedAs: 'Fee ? Bilal' }])
  })

  it('produces no warning for ordinary statements, and none from wording we wrote ourselves', () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { now: NOW })
    expect(d.warnings).toEqual([])
  })
})

describe('statement document — a row is a type and its details', () => {
  it('splits each kind of row so the type can be drawn bold and the details grey, and the words still join to the same line', () => {
    const transfer = je({ ref: 'JV-002', debitAccount: CUST, creditAccount: OTHER, debitLabel: customer.name, creditLabel: other.name, amount: 700 })
    const manual = je({ ref: 'JV-009', debitAccount: CUST, creditAccount: 'capital', debitLabel: customer.name, creditLabel: 'Capital', amount: 250, narration: 'Opening adjustment', createdAt: '2026-09-15T11:00:00.000Z' })
    const cleared = chq({ direction: 'Inward', amount: 500, status: 'Cleared', bank: 'HBL', number: '001234', updatedAt: '2026-09-16T09:00:00.000Z' })
    const d = buildStatementDocument(src({ activity: dubai(), journalEntries: [transfer, manual], cheques: [cleared] }), { now: NOW })
    const rows = d.groups.flatMap((g) => g.entries)
    const by = (t: string) => rows.find((e) => e.type === t)!

    expect([by('Sale').type, by('Sale').detail, by('Sale').joiner]).toEqual(['Sale', '500 AED @ 80', ' \u00b7 '])
    expect([by('Payment received').type, by('Payment received').detail]).toEqual(['Payment received', 'Cash'])
    expect([by('Cheque cleared').type, by('Cheque cleared').detail]).toEqual(['Cheque cleared', 'HBL 001234'])
    expect([by('Transfer to').type, by('Transfer to').detail, by('Transfer to').joiner]).toEqual(['Transfer to', 'Bilal Traders', ' '])
    // A narration IS the type — the words the person wrote — with nothing after it.
    expect([by('Opening adjustment').type, by('Opening adjustment').detail]).toEqual(['Opening adjustment', ''])

    // And nothing about the words changed: description is still exactly type + joiner + detail.
    for (const e of rows) expect(e.description).toBe(e.detail ? `${e.type}${e.joiner}${e.detail}` : e.type)
  })
})
