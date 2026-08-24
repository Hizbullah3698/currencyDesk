// All domain/business types (Account, Activity, Cheque, JournalEntry, Role, Stocks, the report
// period types, ACCOUNT_TYPES, etc.) now live in the shared @currencydesk/engine package, used
// by both this frontend and the backend so the two never drift apart. Re-exported here so the
// many existing `from './types'` imports across the app don't all need to change.
export * from '@currencydesk/engine'

import type { AccountType, SettlementMethod } from '@currencydesk/engine'

// UI-only form state — these are specific to how this frontend's pages hold in-progress form
// input, so they stay here rather than in the shared package (the backend has no use for them).

export interface AcctFormState {
  open: boolean
  mode: 'new' | 'edit'
  id: string
  type: AccountType
  name: string
  phone: string
  city: string
  notes: string
  bankName: string
  accountNo: string
  category: string
  designation: string
  monthlySalary: string
  code: string
  opening: string
  error: string
  typeOverride: boolean
}

export interface TradeFormState {
  customerId: string
  custSearch: string
  currency: string
  amount: string
  rate: string
  pkrValue: string
  lastEdit: 'rate' | 'value'
  method: SettlementMethod
  paidNow: string
  bankId: string
  chqNo: string
  chqBank: string
  step: 'form' | 'review' | 'done'
  locked: boolean
  error: string
}

export interface SettleFormState {
  customerId: string
  custSearch: string
  amount: string
  method: SettlementMethod
  bankId: string
  chqNo: string
  chqBank: string
  step: 'form' | 'review' | 'done'
  locked: boolean
  error: string
  originalReceivable?: number
  originalPayable?: number
}

export interface JournalFormState {
  debitAccount: string
  debitAmount: string
  creditAccount: string
  creditAmount: string
  narration: string
  error: string
}
