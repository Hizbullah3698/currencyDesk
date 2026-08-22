import type { Account, Activity, Cheque, JournalEntry, Stocks } from './types'
import { daysAgoIso } from './engine'

export function seedAccounts(): Account[] {
  return [
    { id: 'bank', type: 'Bank', name: 'Bank — Meezan', system: true, bankName: 'Meezan Bank', accountNo: '0102-4471-9', notes: 'Primary settlement account.', since: 'Mar 2023', createdAt: daysAgoIso(900, 9), createdBy: 'System', updatedAt: daysAgoIso(900, 9), updatedBy: 'System' },
    { id: 'bank2', type: 'Bank', name: 'Bank — HBL', bankName: 'Habib Bank', accountNo: '4471-0092-3', notes: 'Second settlement account.', since: 'Feb 2025', createdAt: daysAgoIso(180, 10), createdBy: 'Admin', updatedAt: daysAgoIso(180, 10), updatedBy: 'Admin' },
    { id: 'cash', type: 'Cash', name: 'Cash in hand', system: true, notes: 'Counter drawer.', since: 'Mar 2023', createdAt: daysAgoIso(900, 9), createdBy: 'System', updatedAt: daysAgoIso(900, 9), updatedBy: 'System' },
    { id: 'currency', type: 'Currency Stock', name: 'Currency stock (AED)', system: true, code: 'AED', notes: 'Quantity and weighted-average cost are derived from the currency ledger.', since: 'Mar 2023', createdAt: daysAgoIso(900, 9), createdBy: 'System', updatedAt: daysAgoIso(900, 9), updatedBy: 'System' },
    { id: 'margin', type: 'Income', name: 'Margin / Income', system: true, notes: 'Trading margin on currency sales, plus anything journalled to Income.', since: 'Mar 2023', createdAt: daysAgoIso(900, 9), createdBy: 'System', updatedAt: daysAgoIso(900, 9), updatedBy: 'System' },
    { id: 'expense', type: 'Expense', name: 'Expenses', system: true, category: 'General', notes: '', since: 'Mar 2023', createdAt: daysAgoIso(900, 9), createdBy: 'System', updatedAt: daysAgoIso(900, 9), updatedBy: 'System' },
    { id: 'salaryExpense', type: 'Expense', name: 'Salary Expense', system: true, category: 'Payroll', notes: 'Debited when a pay period is accrued.', since: 'Mar 2023', createdAt: daysAgoIso(900, 9), createdBy: 'System', updatedAt: daysAgoIso(900, 9), updatedBy: 'System' },
    { id: 'salaryPayable', type: 'Payable', name: 'Salary Payable', system: true, notes: 'Accrued salary not yet paid out.', since: 'Mar 2023', createdAt: daysAgoIso(900, 9), createdBy: 'System', updatedAt: daysAgoIso(900, 9), updatedBy: 'System' },
    { id: 'capital', type: 'Capital', name: 'Opening Balance / Capital', system: true, notes: '', since: 'Mar 2023', createdAt: daysAgoIso(900, 9), createdBy: 'System', updatedAt: daysAgoIso(900, 9), updatedBy: 'System' },
    { id: 'e1', type: 'Employee', name: 'Faisal Iqbal', designation: 'Counter dealer', monthlySalary: 85000, phone: '+92 301 2204 118', city: 'Lahore', notes: '', since: 'Apr 2024', createdAt: daysAgoIso(480, 10), createdBy: 'Admin', updatedAt: daysAgoIso(480, 10), updatedBy: 'Admin' },
    { id: 'e2', type: 'Employee', name: 'Nida Shah', designation: 'Accounts assistant', monthlySalary: 65000, phone: '+92 336 7781 400', city: 'Lahore', notes: '', since: 'Nov 2024', createdAt: daysAgoIso(280, 10), createdBy: 'Admin', updatedAt: daysAgoIso(280, 10), updatedBy: 'Admin' },
    { id: 'c1', type: 'Customer', name: 'Ali Raza', receivable: 820000, payable: 390000, openingReceivable: 270000, openingPayable: 0, openingPosted: true, phone: '+92 300 4412 907', city: 'Lahore', notes: '', since: 'Mar 2024', createdAt: daysAgoIso(520, 11), createdBy: 'Admin', updatedAt: daysAgoIso(520, 11), updatedBy: 'Admin' },
    { id: 'c2', type: 'Customer', name: 'Ahmed Khan', receivable: 0, payable: 150000, openingReceivable: 0, openingPayable: 0, phone: '+92 321 7788 210', city: 'Karachi', notes: '', since: 'Jan 2025', createdAt: daysAgoIso(220, 11), createdBy: 'Admin', updatedAt: daysAgoIso(220, 11), updatedBy: 'Admin' },
    { id: 'c3', type: 'Customer', name: 'Sara Malik', receivable: 300000, payable: 0, openingReceivable: 0, openingPayable: 0, phone: '+92 333 5561 044', city: 'Lahore', notes: '', since: 'Sep 2024', createdAt: daysAgoIso(340, 11), createdBy: 'Admin', updatedAt: daysAgoIso(340, 11), updatedBy: 'Admin' },
    { id: 'c4', type: 'Customer', name: 'Bilal Traders', receivable: 150000, payable: 0, openingReceivable: 0, openingPayable: 0, phone: '+92 302 9014 335', city: 'Faisalabad', notes: '', since: 'Jun 2023', createdAt: daysAgoIso(790, 11), createdBy: 'Admin', updatedAt: daysAgoIso(790, 11), updatedBy: 'Admin' },
  ]
}

export function seedActivity(): Activity[] {
  return [
    { id: 't7', createdAt: daysAgoIso(0, 15), createdBy: 'Admin', updatedAt: daysAgoIso(0, 15), updatedBy: 'Admin', type: 'receive', customerId: 'c1', customerName: 'Ali Raza', amount: 50000, pkrValue: 50000, method: 'Bank', settlementAccountId: 'bank' },
    { id: 't7b', createdAt: daysAgoIso(0, 14), createdBy: 'Admin', updatedAt: daysAgoIso(0, 14), updatedBy: 'Admin', type: 'receive', customerId: 'c1', customerName: 'Ali Raza', amount: 220000, pkrValue: 220000, method: 'Cheque', chequeHeld: true, chequeId: 'q4', settlementAccountId: 'bank' },
    { id: 't6', createdAt: daysAgoIso(0, 13), createdBy: 'Admin', updatedAt: daysAgoIso(0, 13), updatedBy: 'Admin', currency: 'AED', type: 'purchase', customerId: 'c1', customerName: 'Ali Raza', amount: 5000, rate: 78, pkrValue: 390000, method: 'Credit', paidNow: 0, outstanding: 390000, settlementAccountId: '' },
    { id: 't5', createdAt: daysAgoIso(0, 12), createdBy: 'Admin', updatedAt: daysAgoIso(0, 12), updatedBy: 'Admin', currency: 'AED', type: 'sale', customerId: 'c1', customerName: 'Ali Raza', amount: 10000, rate: 82, pkrValue: 820000, cost: 780000, margin: 40000, method: 'Credit', paidNow: 0, outstanding: 820000, settlementAccountId: '' },
    { id: 't4', createdAt: daysAgoIso(0, 11), createdBy: 'Admin', updatedAt: daysAgoIso(0, 11), updatedBy: 'Admin', currency: 'AED', type: 'sale', customerId: 'c3', customerName: 'Sara Malik', amount: 4000, rate: 83, pkrValue: 332000, cost: 312000, margin: 20000, method: 'Bank', paidNow: 32000, outstanding: 300000, settlementAccountId: 'bank' },
    { id: 't3', createdAt: daysAgoIso(1, 16), createdBy: 'Admin', updatedAt: daysAgoIso(1, 16), updatedBy: 'Admin', currency: 'AED', type: 'purchase', customerId: 'c2', customerName: 'Ahmed Khan', amount: 2000, rate: 75, pkrValue: 150000, method: 'Credit', paidNow: 0, outstanding: 150000, settlementAccountId: '' },
    { id: 't2', createdAt: daysAgoIso(1, 12), createdBy: 'Admin', updatedAt: daysAgoIso(1, 12), updatedBy: 'Admin', currency: 'AED', type: 'sale', customerId: 'c4', customerName: 'Bilal Traders', amount: 2000, rate: 80, pkrValue: 160000, cost: 156255, margin: 3745, method: 'Cash', paidNow: 10000, outstanding: 150000, settlementAccountId: 'cash' },
    { id: 't1', createdAt: daysAgoIso(2, 10), createdBy: 'Admin', updatedAt: daysAgoIso(2, 10), updatedBy: 'Admin', currency: 'AED', type: 'purchase', customerId: null, customerName: 'Currency Vendor', amount: 15000, rate: 79, pkrValue: 1185000, method: 'Bank', paidNow: 1185000, outstanding: 0, settlementAccountId: 'bank2' },
  ]
}

export function seedCheques(): Cheque[] {
  return [
    { id: 'q1', createdAt: daysAgoIso(17, 11), createdBy: 'Admin', updatedAt: daysAgoIso(17, 11), updatedBy: 'Admin', direction: 'Inward', number: '004182', party: 'Sara Malik', customerId: 'c3', bank: 'Meezan', bankAccountId: 'bank', amount: 300000, due: 'Aug 8', status: 'Pending', ledgerApplied: false, history: ['Recorded Aug 1'] },
    { id: 'q2', createdAt: daysAgoIso(16, 11), createdBy: 'Admin', updatedAt: daysAgoIso(16, 11), updatedBy: 'Admin', direction: 'Inward', number: '771204', party: 'Bilal Traders', customerId: 'c4', bank: 'HBL', bankAccountId: 'bank2', amount: 150000, due: 'Aug 12', status: 'Deposited', ledgerApplied: false, history: ['Recorded Aug 2', 'Deposited Aug 4'] },
    { id: 'q3', createdAt: daysAgoIso(15, 11), createdBy: 'Admin', updatedAt: daysAgoIso(15, 11), updatedBy: 'Admin', direction: 'Outward', number: '900341', party: 'Ahmed Khan', customerId: 'c2', bank: 'UBL', bankAccountId: 'bank', amount: 150000, due: 'Aug 9', status: 'Pending', ledgerApplied: false, history: ['Recorded Aug 3'] },
    { id: 'q4', createdAt: daysAgoIso(23, 11), createdBy: 'Admin', updatedAt: daysAgoIso(23, 11), updatedBy: 'Admin', direction: 'Inward', number: '004119', party: 'Ali Raza', customerId: 'c1', bank: 'Meezan', bankAccountId: 'bank', amount: 220000, due: 'Aug 1', status: 'Cleared', ledgerApplied: true, history: ['Recorded Jul 26', 'Deposited Jul 29', 'Cleared Aug 1'] },
    { id: 'q5', createdAt: daysAgoIso(25, 11), createdBy: 'Admin', updatedAt: daysAgoIso(25, 11), updatedBy: 'Admin', direction: 'Outward', number: '900318', party: 'Currency Vendor', customerId: null, bank: 'UBL', bankAccountId: 'bank', amount: 480000, due: 'Jul 29', status: 'Returned', ledgerApplied: false, history: ['Recorded Jul 24', 'Deposited Jul 27', 'Returned Jul 29'] },
  ]
}

export function seedJournalEntries(): JournalEntry[] {
  return [
    {
      id: 'j1', ref: 'JV-001', narration: 'Opening balance — Ali Raza', openingFor: 'c1',
      debitAccount: 'c1', creditAccount: 'capital', debitLabel: 'Ali Raza', creditLabel: 'Opening Balance / Capital',
      amount: 270000, createdAt: daysAgoIso(40, 9), createdBy: 'Admin', updatedAt: daysAgoIso(40, 9), updatedBy: 'Admin',
    },
  ]
}

export function seedStocks(): Stocks {
  return { AED: { available: 40000, avgCost: 78 } }
}
