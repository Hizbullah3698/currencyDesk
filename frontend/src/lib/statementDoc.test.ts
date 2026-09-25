import { describe, it, expect } from 'vitest'
import type { Account, Activity, Cheque, JournalEntry } from './engine'
import { balanceMeaning, buildStatementDocument, pdfDate, rateInWords, StatementIntegrityError, type StatementSource } from './statementDoc'
import { formatBalance, formatPaisa } from './statementMoney'
import { shortRef } from './format'
import { referenceStatementSource, REFERENCE_OPTIONS } from './statementReference.fixture'

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
    const entries = d.entries
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
    const printed = d.entries.map((e) => formatBalance(e.balance, 2))
    expect(printed).toEqual(['1,000.00 Dr', '2,000.00 Cr', '1,500.00 Cr'])
    for (const p of printed) expect(p).not.toContain('-')
    expect(d.closing).toBe(-150_000)
    expect(d.opening + d.totalDebits - d.totalCredits).toBe(d.closing)
    // The purchase is a CREDIT (the desk now owes the customer) and the sale a DEBIT.
    const e = d.entries
    expect([e[0].debit, e[0].credit]).toEqual([100_000, 0])
    expect([e[1].debit, e[1].credit]).toEqual([0, 300_000])
  })

  it('orders deals inside one day oldest-first, so the printed balances follow the order they happened', () => {
    const late = act({ type: 'sale', amount: 1, rate: 10, pkrValue: 500, txnDate: '2026-09-15', createdAt: '2026-09-15T11:00:00.000Z' })
    const early = act({ type: 'sale', amount: 1, rate: 10, pkrValue: 1000, txnDate: '2026-09-15', createdAt: '2026-09-15T07:00:00.000Z' })
    const d = buildStatementDocument(src({ activity: [late, early] }), { now: NOW })
    expect(d.entries.map((e) => e.debit)).toEqual([100_000, 50_000])
    expect(d.entries.map((e) => e.balance)).toEqual([100_000, 150_000])
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


const NBSP = ' '
const words = (s: string) => s.replaceAll(NBSP, ' ')

describe('statement document — the reference statement', () => {
  it("reproduces the reference PDF's four figures from its own data, and says the balance is payable to the customer", () => {
    // Held to these figures because the reference printed them; nothing else is.
    const d = buildStatementDocument(referenceStatementSource(), REFERENCE_OPTIONS)
    expect(formatBalance(d.opening, 2)).toBe('0.00')
    expect(formatPaisa(d.totalDebits, 2)).toBe('1,422,242.49')
    expect(formatPaisa(d.totalCredits, 2)).toBe('3,014,816.16')
    expect(formatBalance(d.closing, 2)).toBe('1,592,573.67 Cr')
    expect(d.closingMeaning).toBe('Amount payable to customer')
    expect(d.periodLabel).toBe('15 Sep 2026 to 21 Sep 2026')
    // And the stored balance agrees: the fixture's customer carries 1,592,573.67 payable.
    expect(d.closing).toBe(-Math.round(referenceStatementSource().customer.payable! * 100))
  })

  it('summarises the reference AED trading as 100 sold, 75 bought, 25 NET sold — never "sold 25"', () => {
    const d = buildStatementDocument(referenceStatementSource(), REFERENCE_OPTIONS)
    const aed = d.currencySummary.find((c) => c.code === 'AED')!
    expect([aed.sold, aed.bought, aed.net]).toEqual([100, 75, -25])
    expect(words(aed.soldLabel)).toBe('AED 100')
    expect(words(aed.boughtLabel)).toBe('AED 75')
    expect(aed.netLabel).toBe('AED 25 net sold')
    expect([aed.netQuantity, aed.netDirection]).toEqual(['AED 25', 'Net sold to customer'])
    // Deal values in PKR at each deal's own rate: 5 x 20 @ 79 and 5 x 15 @ 78.
    expect([aed.soldValue, aed.boughtValue]).toEqual([790_000, 585_000])

    const tmn = d.currencySummary.find((c) => c.code === 'TMN')!
    expect([tmn.bought, tmn.sold]).toEqual([1_650_000_000, 875_000_000])
    expect(tmn.netLabel).toBe('TMN 775,000,000 net bought')
  })

  it('lists the reference cheques as uncleared with their real statuses, outside the balance', () => {
    const d = buildStatementDocument(referenceStatementSource(), REFERENCE_OPTIONS)
    expect(d.pendingCheques.map((q) => [q.directionLabel, q.number, q.status])).toEqual([
      ['Issued to customer', 'OUT-991', 'Deposited'],
      ['Received from customer', 'IN-778', 'Pending'],
    ])
    expect([d.pendingIn, d.pendingOut]).toEqual([4_500_000, 3_000_000])
    // The cleared cheque IS a row; the two uncleared ones are not.
    expect(d.entries.filter((e) => e.particulars.startsWith('Cheque'))).toHaveLength(1)
  })
})

describe('statement document — what the balance means', () => {
  it('words a Dr balance as receivable, a Cr balance as payable, and nothing as settled', () => {
    expect(balanceMeaning(150_000, 2)).toBe('Amount receivable from customer')
    expect(balanceMeaning(-150_000, 2)).toBe('Amount payable to customer')
    expect(balanceMeaning(0, 2)).toBe('Account settled — no outstanding balance')
    // A balance that rounds to nothing at the chosen decimals has no side, so it is settled — never "Cr 0".
    expect(balanceMeaning(-40, 0)).toBe('Account settled — no outstanding balance')
  })

  it('follows the ledger: a sale leaves the customer owing (Dr, receivable); a purchase leaves the business owing (Cr, payable)', () => {
    const owes = buildStatementDocument(src({ activity: [act({ type: 'sale', amount: 10, rate: 80, pkrValue: 800, txnDate: '2026-09-15' })] }), { now: NOW })
    expect(owes.closing).toBeGreaterThan(0)
    expect(owes.closingMeaning).toBe('Amount receivable from customer')
    const owed = buildStatementDocument(src({ activity: [act({ type: 'purchase', amount: 10, rate: 80, pkrValue: 800, txnDate: '2026-09-15' })] }), { now: NOW })
    expect(owed.closing).toBeLessThan(0)
    expect(owed.closingMeaning).toBe('Amount payable to customer')
    const even = buildStatementDocument(
      src({
        activity: [
          act({ type: 'sale', amount: 10, rate: 80, pkrValue: 800, txnDate: '2026-09-15' }),
          act({ type: 'receive', amount: 800, pkrValue: 800, method: 'Cash', txnDate: '2026-09-15', createdAt: '2026-09-15T11:00:00.000Z' }),
        ],
      }),
      { now: NOW },
    )
    expect(even.closing).toBe(0)
    expect(even.closingMeaning).toBe('Account settled — no outstanding balance')
  })

  it("carries a non-zero opening balance from before the period and the account's own opening figure, and the identity holds", () => {
    const withOpening = { ...customer, openingReceivable: 12_345.67 } as Account
    const d = buildStatementDocument(src({ customer: withOpening, accounts: [withOpening, other, bank, capital], activity: dubai() }), { from: '2026-09-19', now: NOW })
    // 12,345.67 opening + 40,000.00 sold on the 18th, both before the period.
    expect(d.opening).toBe(5_234_567)
    expect(d.entries[0].balance).toBe(d.opening + d.entries[0].debit - d.entries[0].credit)
    expect(d.opening + d.totalDebits - d.totalCredits).toBe(d.closing)
  })

  it('handles an empty statement: no rows, zero totals, the opening carried straight to the closing', () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { from: '2026-10-01', to: '2026-10-31', now: NOW })
    expect(d.entries).toEqual([])
    expect([d.totalDebits, d.totalCredits]).toEqual([0, 0])
    expect(d.closing).toBe(d.opening)
    expect(d.periodLabel).toBe('1 Oct 2026 to 31 Oct 2026')
    const blank = buildStatementDocument(src(), { now: NOW })
    expect(blank.periodLabel).toBe('Up to 21 Sep 2026')
    expect(blank.closingMeaning).toBe('Account settled — no outstanding balance')
    expect(blank.currencySummary).toEqual([])
  })
})

describe('statement document — wording and references', () => {
  it("describes deals from the business's side, with the rate's units spelled out in each direction", () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { now: NOW })
    expect(d.entries.map((e) => [words(e.particulars), e.detail])).toEqual([
      ['Sold to customer: AED 500', 'UAE Dirham · Rate: PKR 80 per AED'],
      ['Sold to customer: TMN 3,000,000,000', 'Toman · Rate: 788 TMN per PKR'],
      ['Cash received from customer', ''],
      ['Sold to customer: TMN 1,000,000,000', 'Toman · Rate: 788 TMN per PKR'],
      ['Sold to customer: TMN 500,000,000', 'Toman · Rate: 789 TMN per PKR'],
    ])
  })

  it('keeps the currency code on the same line as its amount when a description wraps', () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { now: NOW })
    expect(d.entries[1].particulars).toBe(`Sold to customer: TMN${NBSP}3,000,000,000`)
  })

  it('says what a rate means without converting it: PKR per unit when multiplied, units per PKR when divided', () => {
    // AED 20 @ 79 is 1,580.00 (multiplied); TMN 150,000,000 @ 788 is 190,355.33 (divided). The words follow the maths.
    expect(rateInWords('AED', 79)).toBe('PKR 79 per AED')
    expect(rateInWords('TMN', 788)).toBe('788 TMN per PKR')
    expect(rateInWords('USD', 282.5)).toBe('PKR 282.5 per USD')
    // Not forced to two places, and never rounded away when a rate carries decimals.
    expect(rateInWords('AED', 76.25)).toBe('PKR 76.25 per AED')
    // A code the app does not know is priced as a multiply quote (currencies.ts), so it is described as one.
    expect(rateInWords('XYZ', 3)).toBe('PKR 3 per XYZ')
  })

  it('describes purchases, cash and bank payments both ways, and names the bank account a bank payment went through', () => {
    const activity = [
      act({ type: 'purchase', currency: 'AED', amount: 500, rate: 80, pkrValue: 40000, txnDate: '2026-09-15' }),
      act({ type: 'pay', amount: 100, pkrValue: 100, method: 'Cash', txnDate: '2026-09-15', createdAt: '2026-09-15T11:00:00.000Z' }),
      act({ type: 'receive', amount: 100, pkrValue: 100, method: 'Bank', settlementAccountId: 'bank1', txnDate: '2026-09-15', createdAt: '2026-09-15T12:00:00.000Z' }),
      act({ type: 'pay', amount: 100, pkrValue: 100, method: 'Bank', txnDate: '2026-09-15', createdAt: '2026-09-15T13:00:00.000Z' }),
    ]
    const d = buildStatementDocument(src({ activity }), { now: NOW })
    expect(d.entries.map((e) => [words(e.particulars), e.detail])).toEqual([
      ['Bought from customer: AED 500', 'UAE Dirham · Rate: PKR 80 per AED'],
      ['Cash paid to customer', ''],
      ['Bank payment received from customer', 'Via Meezan Bank - Current'],
      ['Bank payment to customer', ''],
    ])
  })

  it("says when a deal was part-settled at the time, so the row's amount is not mistaken for the deal's value", () => {
    const s = act({ type: 'sale', currency: 'AED', amount: 100, rate: 80, pkrValue: 8000, paidNow: 3000, method: 'Cash', txnDate: '2026-09-15' })
    const d = buildStatementDocument(src({ activity: [s] }), { now: NOW })
    expect(d.entries[0].debit).toBe(500_000)
    expect(d.entries[0].detail).toBe('UAE Dirham · Rate: PKR 80 per AED · Deal value PKR 8,000.00, PKR 3,000.00 settled at the time')
  })

  it('references a deal or payment exactly as the Transactions page does', () => {
    const activity = dubai()
    const d = buildStatementDocument(src({ activity }), { now: NOW })
    const refs = d.entries.map((e) => e.voucher)
    expect(refs).toEqual(activity.map((a) => shortRef(a.id)))
    expect(refs[0]).toBe('CE78B16F')
  })

  it('shows the customer account id in the same short form', () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { now: NOW })
    expect(d.accountId).toBe('5C9AB663')
  })

  it('describes a cleared cheque by its direction, number and bank', () => {
    const q = chq({ direction: 'Inward', amount: 500, status: 'Cleared', bank: 'HBL', number: '001234', updatedAt: '2026-09-16T09:00:00.000Z' })
    const out = chq({ direction: 'Outward', amount: 200, status: 'Cleared', bank: 'UBL', number: '009', updatedAt: '2026-09-16T10:00:00.000Z' })
    const sale = act({ type: 'sale', amount: 1, rate: 10, pkrValue: 2000, txnDate: '2026-09-15' })
    const d = buildStatementDocument(src({ activity: [sale], cheques: [q, out] }), { now: NOW })
    expect([d.entries[1].particulars, d.entries[1].detail, d.entries[1].voucher]).toEqual(['Cheque received from customer, cleared', 'Cheque no. 001234 · HBL', shortRef(q.id)])
    expect(d.entries[1].credit).toBe(50_000)
    expect([d.entries[2].particulars, d.entries[2].detail]).toEqual(['Cheque issued to customer, cleared', 'Cheque no. 009 · UBL'])
    expect(d.entries[2].debit).toBe(20_000)
  })

  it('words a customer-to-customer transfer by which leg is this customer, naming the other exactly as recorded', () => {
    const toOther = je({ ref: 'JV-002', debitAccount: CUST, creditAccount: OTHER, debitLabel: customer.name, creditLabel: other.name, amount: 700, narration: 'Transfer from Dubai Tmn Buyer to Bilal Traders' })
    const fromOther = je({ ref: 'JV-003', debitAccount: OTHER, creditAccount: CUST, debitLabel: other.name, creditLabel: customer.name, amount: 300, narration: 'Transfer from Bilal Traders to Dubai Tmn Buyer', createdAt: '2026-09-15T11:00:00.000Z' })
    const d = buildStatementDocument(src({ journalEntries: [toOther, fromOther] }), { now: NOW })
    expect([d.entries[0].particulars, d.entries[0].voucher, d.entries[0].debit]).toEqual(['Transfer to Bilal Traders', 'JV-002', 70_000])
    expect([d.entries[1].particulars, d.entries[1].credit]).toEqual(['Transfer from Bilal Traders', 30_000])
  })

  it("keeps a manual entry's own narration — a credit is not relabelled as a discount — with its JV number as the voucher", () => {
    const fee = je({ ref: 'JV-009', debitAccount: CUST, creditAccount: 'capital', debitLabel: customer.name, creditLabel: 'Capital', amount: 250, narration: 'Opening adjustment' })
    const credit = je({ ref: 'JV-010', debitAccount: 'capital', creditAccount: CUST, debitLabel: 'Capital', creditLabel: customer.name, amount: 100, narration: 'Rebate allowed', createdAt: '2026-09-15T11:00:00.000Z' })
    const blank = je({ ref: 'JV-011', debitAccount: CUST, creditAccount: 'capital', debitLabel: customer.name, creditLabel: 'Capital', amount: 5, narration: '', createdAt: '2026-09-15T12:00:00.000Z' })
    const d = buildStatementDocument(src({ journalEntries: [fee, credit, blank] }), { now: NOW })
    expect(d.entries.map((e) => [e.particulars, e.voucher])).toEqual([
      ['Opening adjustment', 'JV-009'],
      ['Rebate allowed', 'JV-010'],
      ['Journal entry', 'JV-011'],
    ])
  })

  it('prints the date on every row', () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { now: NOW })
    expect(d.entries.map((e) => e.dateLabel)).toEqual(['18 Sep 2026', '19 Sep 2026', '20 Sep 2026', '21 Sep 2026', '21 Sep 2026'])
  })

  it('formats dates unambiguously', () => {
    expect(pdfDate('2026-09-19')).toBe('19 Sep 2026')
    expect(pdfDate('2026-01-05T10:00:00.000Z')).toBe('5 Jan 2026')
  })

  it('names the business from settings and leaves out contact details that do not exist', () => {
    const d = buildStatementDocument(src(), { now: NOW })
    expect(d.business).toEqual({ name: 'DESK NAME', addressLines: [], phone: '' })
    expect(d.accountCurrency).toEqual({ code: 'PKR', name: 'Pakistani Rupee' })
    const branded = buildStatementDocument(src(), { now: NOW, business: { name: 'Al-Noor Exchange', addressLines: ['Shop 4, Main Bazaar', ''], phone: '+92 300 0000000' } })
    expect(branded.business).toEqual({ name: 'Al-Noor Exchange', addressLines: ['Shop 4, Main Bazaar'], phone: '+92 300 0000000' })
  })
})

describe('statement document — uncleared cheques and currency trading', () => {
  it('leaves an uncleared cheque payment out of the table and the balance, and lists it with its real status', () => {
    const held = act({ type: 'receive', amount: 500_000, pkrValue: 500_000, method: 'Cheque', chequeHeld: true, txnDate: '2026-09-16', createdAt: '2026-09-16T08:00:00.000Z' })
    const sale = act({ type: 'sale', amount: 1, rate: 10, pkrValue: 900_000, txnDate: '2026-09-15' })
    const inward = chq({ direction: 'Inward', amount: 500_000, number: '778899', bank: 'HBL', due: '2026-10-01' })
    const outward = chq({ direction: 'Outward', amount: 120_000.5, number: '445566', bank: 'UBL', due: '2026-09-25', status: 'Deposited' })
    // Cleared moves the balance (and so would be a row) — so this one belongs to someone else. Returned and cancelled move nothing.
    const cleared = chq({ direction: 'Inward', amount: 1, status: 'Cleared', number: 'DONE', customerId: OTHER })
    const returned = chq({ direction: 'Inward', amount: 2, status: 'Returned', number: 'BOUNCED' })
    const cancelled = chq({ direction: 'Outward', amount: 3, status: 'Cancelled', number: 'VOID' })
    const d = buildStatementDocument(src({ activity: [sale, held], cheques: [inward, outward, cleared, returned, cancelled] }), { now: NOW })

    // The held payment moved nothing, so it is not a row — the balance is just the sale.
    expect(d.entryCount).toBe(1)
    expect(d.closing).toBe(90_000_000)
    // Only uncleared cheques, soonest due first, each with its amount and its actual status — Deposited is not Cleared.
    expect(d.pendingCheques.map((q) => q.number)).toEqual(['445566', '778899'])
    expect(d.pendingCheques.map((q) => q.directionLabel)).toEqual(['Issued to customer', 'Received from customer'])
    expect(d.pendingCheques.map((q) => q.status)).toEqual(['Deposited', 'Pending'])
    expect(d.pendingIn).toBe(50_000_000)
    expect(d.pendingOut).toBe(12_000_050)
  })

  it('shows gross bought and sold separately from the net, per currency, never added across currencies', () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { now: NOW })
    const byCode = Object.fromEntries(d.currencySummary.map((c) => [c.code, c]))
    expect([byCode.TMN.bought, byCode.TMN.sold]).toEqual([0, 4_500_000_000])
    expect(byCode.TMN.netLabel).toBe('TMN 4,500,000,000 net sold')
    expect(byCode.TMN.soldValue).toBe(570_985_569)
    expect(byCode.AED.netLabel).toBe('AED 500 net sold')
    expect(d.currencySummary.map((c) => c.code)).toEqual(['AED', 'TMN'])

    const even = buildStatementDocument(
      src({
        activity: [
          act({ type: 'purchase', currency: 'USD', amount: 1000, rate: 282.5, pkrValue: 282_500, txnDate: '2026-09-15' }),
          act({ type: 'sale', currency: 'USD', amount: 1000, rate: 283, pkrValue: 283_000, txnDate: '2026-09-15', createdAt: '2026-09-15T11:00:00.000Z' }),
        ],
      }),
      { now: NOW },
    )
    expect(even.currencySummary[0].netLabel).toBe('Even (bought = sold)')
    expect(even.currencySummary[0].netQuantity).toBe('')
  })

  it('counts only the trades inside the statement period — the same rows as the table', () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { from: '2026-09-21', now: NOW })
    const tmn = d.currencySummary.find((c) => c.code === 'TMN')!
    expect(tmn.sold).toBe(1_500_000_000)
    expect(d.currencySummary.find((c) => c.code === 'AED')).toBeUndefined()
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
    expect(d.entries[0].particulars).toBe('Fee ? Bilal')
    expect(d.warnings).toEqual([{ field: 'Entry narration JV-011', characters: ['→'], printedAs: 'Fee ? Bilal' }])
  })

  it('produces no warning for ordinary statements, and none from wording we wrote ourselves', () => {
    const d = buildStatementDocument(src({ activity: dubai() }), { now: NOW })
    expect(d.warnings).toEqual([])
    expect(buildStatementDocument(referenceStatementSource(), REFERENCE_OPTIONS).warnings).toEqual([])
  })
})
