export type Role = 'admin' | 'user'

export type AccountType =
  | 'Customer'
  | 'Bank'
  | 'Cash'
  | 'Currency Stock'
  | 'Expense'
  | 'Employee'
  | 'Income'
  | 'Capital'
  | 'Payable'

export const ACCOUNT_TYPES: AccountType[] = [
  'Customer',
  'Bank',
  'Cash',
  'Currency Stock',
  'Expense',
  'Employee',
  'Income',
  'Capital',
  'Payable',
]

export interface Account {
  id: string
  type: AccountType
  name: string
  system?: boolean
  notes: string
  since: string
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string

  // Customer
  receivable?: number
  payable?: number
  openingReceivable?: number
  openingPayable?: number
  openingPosted?: boolean

  // Customer / Employee
  phone?: string
  city?: string

  // Bank
  bankName?: string
  accountNo?: string

  // Currency Stock
  code?: string

  // Expense
  category?: string

  // Employee
  designation?: string
  monthlySalary?: number

  // Type-lock / admin-override audit trail
  typeChangedFrom?: AccountType
  typeChangedBy?: string
  typeChangedAt?: string

  // Archive — hides the account from active lists/search without touching its data or
  // transaction history. Distinct from delete, which stays blocked once any activity exists.
  archived?: boolean
  archivedAt?: string
  archivedBy?: string
}

export type SettlementMethod = 'Cash' | 'Bank' | 'Cheque' | 'Credit'
export type ActivityType = 'purchase' | 'sale' | 'receive' | 'pay'

export interface Activity {
  id: string
  type: ActivityType
  currency?: string
  /**
   * The date the deal was actually struck, 'YYYY-MM-DD', as entered by the dealer (defaults to
   * today). Distinct from `createdAt`, which is when the row was keyed in. Read it through
   * `activityDate()` rather than directly — that helper handles both the timezone pinning and
   * the fallback for rows posted before this field existed.
   */
  txnDate?: string
  customerId: string | null
  customerName: string
  amount: number
  rate?: number
  pkrValue: number
  cost?: number
  margin?: number
  method: SettlementMethod
  paidNow?: number
  outstanding?: number
  chequeHeld?: boolean
  chequeId?: string
  settlementAccountId?: string
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export type ChequeDirection = 'Inward' | 'Outward'
export type ChequeStatus = 'Pending' | 'Deposited' | 'Cleared' | 'Returned'

export interface Cheque {
  id: string
  direction: ChequeDirection
  number: string
  party: string
  customerId: string | null
  bank: string
  bankAccountId: string
  amount: number
  due: string
  status: ChequeStatus
  ledgerApplied: boolean
  history: string[]
  source?: string
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface SalaryMeta {
  employeeId: string
  period: string
  kind: 'accrual' | 'payment'
}

export interface JournalEntry {
  id: string
  ref: string
  narration: string
  debitAccount: string
  creditAccount: string
  debitLabel: string
  creditLabel: string
  amount: number
  openingFor?: string
  salary?: SalaryMeta
  /**
   * Groups the legs of one deal. A sale needs up to four legs and this table holds two per row,
   * so a deal is several balanced rows sharing this id — see migration 016. Absent on manual
   * entries, opening balances and salary postings, which are each a single pair.
   */
  voucherId?: string
  /** The activity row that produced this leg, when one did. Absent on manual entries. */
  activityId?: string
  /** The cheque whose clearing produced this leg. A leg carries this or `activityId`, never both. */
  chequeId?: string
  /**
   * The day this entry belongs to, 'YYYY-MM-DD' — the journal's counterpart to
   * `Activity.txnDate`, and distinct from `createdAt` (when it was keyed in). Its own stored
   * column rather than a join through `activityId`, because manual entries, opening balances,
   * salary postings and future reversal vouchers have no activity row to join to. See
   * migration 017.
   */
  txnDate?: string
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface StockPosition {
  available: number
  avgCost: number
}

export type Stocks = Record<string, StockPosition>

export type ReportPreset = 'all' | 'month' | 'lastMonth' | '30d' | 'ytd' | 'custom'

export interface RangeBounds {
  fromT: number
  toT: number
  isAll: boolean
  hasFrom: boolean
  hasTo: boolean
  label: string
}
