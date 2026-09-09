import { describe, it, expect } from 'vitest'
import { computeBalanceSheet } from './reports'
import { stampTime } from './engine'
import type { Account, Activity, Cheque, JournalEntry, Stocks } from './types'

// ---------------------------------------------------------------------------
// Balance sheet reconciliation
// ---------------------------------------------------------------------------
// The defect these cover: `balanced` used to be computed from totalDr/totalCr AFTER the equity
// plug had been added into them, which made it a tautology — it could essentially never be false,
// so the "Debits and credits agree across the full dataset" line on the Balance Sheet attested to
// nothing and a genuine posting error was indistinguishable from the expected opening-stock
// residual. It is now judged on `unexplained`: the pre-plug difference minus the one residual
// that is legitimately unjournalled.
// ---------------------------------------------------------------------------

const AUDIT = { createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'System', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'System' }

function account(id: string, type: Account['type'], name: string, extra: Partial<Account> = {}): Account {
  return { id, type, name, notes: '', since: 'Jan 2026', ...AUDIT, ...extra }
}

function activity(extra: Partial<Activity> & Pick<Activity, 'id' | 'type' | 'amount' | 'pkrValue'>): Activity {
  return {
    customerId: 'cust',
    customerName: 'Test Customer',
    method: 'Credit',
    currency: 'AED',
    ...AUDIT,
    ...extra,
  } as Activity
}

const NO_CHEQUES: Cheque[] = []
const NO_JOURNAL: JournalEntry[] = []
const LATER = stampTime('2026-12-31T00:00:00.000Z')

/** The system accounts every sheet carries, minus anything a given test adds itself. */
const BASE_ACCOUNTS: Account[] = [
  account('bank', 'Bank', 'Bank'),
  account('cash', 'Cash', 'Cash'),
  account('capital', 'Capital', 'Opening Balance / Capital'),
  account('margin', 'Income', 'Trading margin'),
]

describe('computeBalanceSheet — reconciliation', () => {
  it('reports balanced with no plug at all on an empty, freshly-seeded desk', () => {
    const accounts = [...BASE_ACCOUNTS, account('currency', 'Currency Stock', 'Currency stock (AED)', { code: 'AED' })]
    const stocks: Stocks = { AED: { available: 0, avgCost: 0 } }

    const result = computeBalanceSheet(accounts, [], NO_CHEQUES, NO_JOURNAL, stocks, LATER)

    expect(result.balanced).toBe(true)
    expect(result.openingStockEquity).toBeCloseTo(0, 2)
    expect(result.unexplained).toBeCloseTo(0, 2)
    expect(result.diags).toHaveLength(0)
  })

  it('attributes genuine pre-ledger currency stock to opening equity and still reports balanced', () => {
    // 1,000 AED at 70 PKR sitting in stock with NO purchase behind it — stock that predates the
    // recorded ledger. There is no originating entry to credit, so 70,000 of assets legitimately
    // has no counterparty. That is a reconciling item, not an error.
    const accounts = [...BASE_ACCOUNTS, account('currency', 'Currency Stock', 'Currency stock (AED)', { code: 'AED' })]
    const stocks: Stocks = { AED: { available: 1000, avgCost: 70 } }

    const result = computeBalanceSheet(accounts, [], NO_CHEQUES, NO_JOURNAL, stocks, LATER)

    expect(result.openingStockEquity).toBeCloseTo(70_000, 2)
    expect(result.unexplained).toBeCloseTo(0, 2)
    expect(result.balanced).toBe(true)
    // The plug still runs so the printed sheet foots...
    expect(result.totalDr).toBeCloseTo(result.totalCr, 2)
    // ...and it says what it absorbed, flagged as expected rather than as a problem.
    expect(result.diags).toHaveLength(1)
    expect(result.diags[0].label).toBe('Opening currency stock')
    expect(result.diags[0].amount).toBeCloseTo(70_000, 2)
  })

  it('reports NOT balanced when a real one-legged posting is present — the regression this fix exists for', () => {
    // A customer receivable with no matching credit anywhere: exactly the shape of a posting that
    // recorded one leg and lost the other. Before the fix, the plug swallowed this whole and the
    // sheet still announced "Debits and credits agree across the full dataset."
    const accounts = [
      ...BASE_ACCOUNTS,
      account('currency', 'Currency Stock', 'Currency stock (AED)', { code: 'AED' }),
      account('cust', 'Customer', 'Orphan Receivable Customer', { receivable: 25_000, payable: 0 }),
    ]
    const stocks: Stocks = { AED: { available: 0, avgCost: 0 } }

    const result = computeBalanceSheet(accounts, [], NO_CHEQUES, NO_JOURNAL, stocks, LATER)

    expect(result.balanced).toBe(false)
    expect(result.unexplained).toBeCloseTo(25_000, 2)
    // The totals themselves still agree, because the plug still ran — which is precisely why
    // `balanced` must never be derived from them.
    expect(result.totalDr).toBeCloseTo(result.totalCr, 2)
    expect(result.diags.some((d) => d.label === 'Unexplained difference')).toBe(true)
  })

  it('separates the expected residual from a real imbalance when both are present at once', () => {
    const accounts = [
      ...BASE_ACCOUNTS,
      account('currency', 'Currency Stock', 'Currency stock (AED)', { code: 'AED' }),
      account('cust', 'Customer', 'Orphan Receivable Customer', { receivable: 25_000, payable: 0 }),
    ]
    const stocks: Stocks = { AED: { available: 1000, avgCost: 70 } }

    const result = computeBalanceSheet(accounts, [], NO_CHEQUES, NO_JOURNAL, stocks, LATER)

    expect(result.openingStockEquity).toBeCloseTo(70_000, 2)
    expect(result.unexplained).toBeCloseTo(25_000, 2)
    expect(result.balanced).toBe(false)
    expect(result.diags.map((d) => d.label)).toEqual(['Opening currency stock', 'Unexplained difference'])
  })

  it('values currency stock AS OF the reporting date, not at today, so a historical sheet still balances', () => {
    // The second half of the same defect. Every other row on this sheet is cut at asOfT, but
    // currency stock was valued from the LIVE position — so any past date mixed two dates and
    // produced a residual the plug then hid. Here: buy 1,000 AED at 70 in March, and ask for the
    // sheet as of February. As of February nothing has happened; the sheet must be empty and
    // balanced, not carrying March's stock against February's (absent) payable.
    const accounts = [
      ...BASE_ACCOUNTS,
      account('currency', 'Currency Stock', 'Currency stock (AED)', { code: 'AED' }),
      account('cust', 'Customer', 'Supplier', { receivable: 0, payable: 70_000 }),
    ]
    const stocks: Stocks = { AED: { available: 1000, avgCost: 70 } }
    const march: Activity[] = [
      activity({
        id: 'a1',
        type: 'purchase',
        amount: 1000,
        rate: 70,
        pkrValue: 70_000,
        txnDate: '2026-03-15',
        createdAt: '2026-03-15T10:00:00.000Z',
        outstanding: 70_000,
        paidNow: 0,
      }),
    ]

    const asOfFebruary = computeBalanceSheet(accounts, march, NO_CHEQUES, NO_JOURNAL, stocks, stampTime('2026-02-28T23:59:59.000Z'))

    // Unwinding March's purchase leaves a zero opening position, so nothing is legitimately
    // unjournalled, and February's sheet has no stock on it at all.
    expect(asOfFebruary.openingStockEquity).toBeCloseTo(0, 2)
    // The group is ABSENT, not present-and-zero. This assertion used to read
    // `stockGroup?.rows[0]?.dr ?? 0`, which passed either way and so tested nothing once zero
    // rows began being suppressed — stating which of the two is true is the point.
    expect(asOfFebruary.groups.find((g) => g.title === 'Currency Stock')).toBeUndefined()
  })

  it('does not treat customer/bank opening balances as unexplained — those are journalled against Capital', () => {
    // createAccount posts a real journal entry against Capital for every opening balance
    // (accountsService.ts, `opening_for`), so these carry their own credit and must NOT be
    // swept into the opening-stock allowance or counted as an imbalance.
    const accounts = [
      ...BASE_ACCOUNTS,
      account('currency', 'Currency Stock', 'Currency stock (AED)', { code: 'AED' }),
      account('cust', 'Customer', 'Opening Balance Customer', { receivable: 40_000, payable: 0, openingReceivable: 40_000, openingPosted: true }),
    ]
    const stocks: Stocks = { AED: { available: 0, avgCost: 0 } }
    const journal: JournalEntry[] = [
      {
        id: 'j1',
        ref: 'JV-1',
        narration: 'Opening balance',
        debitAccount: 'cust',
        creditAccount: 'capital',
        debitLabel: 'Opening Balance Customer',
        creditLabel: 'Opening Balance / Capital',
        amount: 40_000,
        openingFor: 'cust',
        ...AUDIT,
      },
    ]

    const result = computeBalanceSheet(accounts, [], NO_CHEQUES, journal, stocks, LATER)

    expect(result.openingStockEquity).toBeCloseTo(0, 2)
    expect(result.unexplained).toBeCloseTo(0, 2)
    expect(result.balanced).toBe(true)
    expect(result.diags).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Zero rows are not printed
// ---------------------------------------------------------------------------
// The client's "it shows all", 2026-09-09: a desk with two purchases on it printed the four
// untraded currency positions, both empty expense accounts and an unused salary payable as blank
// lines around the few figures that carried anything.
//
// This is PRESENTATION ONLY and these tests exist to hold it to that — every figure the sheet
// reports, and the balanced/unexplained verdict, must be identical with and without the empty
// rows, because a zero contributes zero.
// ---------------------------------------------------------------------------

describe('computeBalanceSheet — empty rows', () => {
  const TRADED: Account[] = [
    ...BASE_ACCOUNTS,
    account('currency', 'Currency Stock', 'Currency stock (AED)', { code: 'AED' }),
    account('currencyUSD', 'Currency Stock', 'Currency stock (USD)', { code: 'USD' }),
    account('currencyJPY', 'Currency Stock', 'Currency stock (JPY)', { code: 'JPY' }),
    account('expense', 'Expense', 'General expenses'),
    account('salaryPayable', 'Payable', 'Salaries payable'),
    account('cust', 'Customer', 'Wazir', { receivable: 0, payable: 250_200 }),
  ]
  // One position held, two currencies untouched.
  const stocks: Stocks = { AED: { available: 0, avgCost: 0 }, USD: { available: 900, avgCost: 278 }, JPY: { available: 0, avgCost: 0 } }

  it('drops accounts with nothing on either side, and the groups left empty by that', () => {
    const result = computeBalanceSheet(TRADED, [], NO_CHEQUES, NO_JOURNAL, stocks, LATER)

    const stockGroup = result.groups.find((g) => g.title === 'Currency Stock')
    expect(stockGroup?.rows.map((r) => r.id)).toEqual(['currencyUSD'])

    // Bank and Cash are both zero, so the group they share does not appear at all.
    expect(result.groups.find((g) => g.title === 'Bank & Cash')).toBeUndefined()
    expect(result.groups.find((g) => g.title === 'Expenses')).toBeUndefined()
    expect(result.groups.find((g) => g.title === 'Other Payables')).toBeUndefined()
  })

  it('keeps every account that does carry a balance', () => {
    const result = computeBalanceSheet(TRADED, [], NO_CHEQUES, NO_JOURNAL, stocks, LATER)

    const customerRows = result.groups.find((g) => g.title === 'Receivables & Payables — Customers')?.rows
    expect(customerRows?.map((r) => r.id)).toEqual(['cust'])
    expect(customerRows?.[0].cr).toBeCloseTo(250_200, 2)
  })

  it('changes no figure and no verdict — the suppressed rows were all zero', () => {
    // The guard on the whole change. Compared against the same books with every empty account
    // removed by hand: if suppressing a row ever moved a total, these two would disagree.
    const withEmpties = computeBalanceSheet(TRADED, [], NO_CHEQUES, NO_JOURNAL, stocks, LATER)
    const withoutEmpties = computeBalanceSheet(
      TRADED.filter((a) => !['bank', 'cash', 'expense', 'salaryPayable', 'currency', 'currencyJPY'].includes(a.id)),
      [],
      NO_CHEQUES,
      NO_JOURNAL,
      { USD: { available: 900, avgCost: 278 } },
      LATER,
    )

    expect(withEmpties.totalDr).toBeCloseTo(withoutEmpties.totalDr, 2)
    expect(withEmpties.totalCr).toBeCloseTo(withoutEmpties.totalCr, 2)
    expect(withEmpties.unexplained).toBeCloseTo(withoutEmpties.unexplained, 2)
    expect(withEmpties.openingStockEquity).toBeCloseTo(withoutEmpties.openingStockEquity, 2)
    expect(withEmpties.balanced).toBe(withoutEmpties.balanced)
  })

  it('still prints the Capital row when it is carrying the presentation plug', () => {
    // THE ONE EXCEPTION to the rule above, and the reason the plug is applied below `push` rather
    // than through it. Capital's own balance here is zero, so suppression would drop the row —
    // and then the plug would have nowhere to land and the printed sheet would stop footing.
    //
    // Stock held with no purchase behind it is what forces a plug: 900 USD at 278 is a debit with
    // no credit anywhere to meet it.
    const openingOnly = [...BASE_ACCOUNTS, account('currencyUSD', 'Currency Stock', 'Currency stock (USD)', { code: 'USD' })]
    const result = computeBalanceSheet(openingOnly, [], NO_CHEQUES, NO_JOURNAL, { USD: { available: 900, avgCost: 278 } }, LATER)

    const capitalRow = result.groups.find((g) => g.title === 'Equity')?.rows.find((r) => r.id === 'capital')
    expect(capitalRow).toBeDefined()
    expect(capitalRow!.cr).toBeCloseTo(250_200, 2)
    expect(result.totalDr).toBeCloseTo(result.totalCr, 2)
    // And it is the legitimate kind of residual, not a real imbalance.
    expect(result.balanced).toBe(true)
  })
})
