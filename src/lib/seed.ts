import type { Account, Activity, Cheque, JournalEntry, Stocks } from './types'
import { sinceLabel } from './engine'

export function seedAccounts(): Account[] {
  const now = new Date().toISOString()
  const since = sinceLabel(new Date())
  return [
    { id: 'bank', type: 'Bank', name: 'Bank', system: true, notes: '', since, createdAt: now, createdBy: 'System', updatedAt: now, updatedBy: 'System' },
    { id: 'cash', type: 'Cash', name: 'Cash in hand', system: true, notes: 'Counter drawer.', since, createdAt: now, createdBy: 'System', updatedAt: now, updatedBy: 'System' },
    { id: 'currency', type: 'Currency Stock', name: 'Currency stock (AED)', system: true, code: 'AED', notes: 'Quantity and weighted-average cost are derived from the currency ledger.', since, createdAt: now, createdBy: 'System', updatedAt: now, updatedBy: 'System' },
    { id: 'margin', type: 'Income', name: 'Margin / Income', system: true, notes: 'Trading margin on currency sales, plus anything journalled to Income.', since, createdAt: now, createdBy: 'System', updatedAt: now, updatedBy: 'System' },
    { id: 'expense', type: 'Expense', name: 'Expenses', system: true, category: 'General', notes: '', since, createdAt: now, createdBy: 'System', updatedAt: now, updatedBy: 'System' },
    { id: 'salaryExpense', type: 'Expense', name: 'Salary Expense', system: true, category: 'Payroll', notes: 'Debited when a pay period is accrued.', since, createdAt: now, createdBy: 'System', updatedAt: now, updatedBy: 'System' },
    { id: 'salaryPayable', type: 'Payable', name: 'Salary Payable', system: true, notes: 'Accrued salary not yet paid out.', since, createdAt: now, createdBy: 'System', updatedAt: now, updatedBy: 'System' },
    { id: 'capital', type: 'Capital', name: 'Opening Balance / Capital', system: true, notes: '', since, createdAt: now, createdBy: 'System', updatedAt: now, updatedBy: 'System' },
  ]
}

export function seedActivity(): Activity[] {
  return []
}

export function seedCheques(): Cheque[] {
  return []
}

export function seedJournalEntries(): JournalEntry[] {
  return []
}

export function seedStocks(): Stocks {
  return { AED: { available: 0, avgCost: 0 } }
}
