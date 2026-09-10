// All domain/business types (Account, Activity, Cheque, JournalEntry, Role, Stocks, the report
// period types, ACCOUNT_TYPES, etc.) now live in the shared @currencydesk/engine package, used
// by both this frontend and the backend so the two never drift apart. Re-exported here so the
// many existing `from './types'` imports across the app don't all need to change.
export * from '@currencydesk/engine'

// This file once also carried AcctFormState / TradeFormState / SettleFormState / JournalFormState —
// a single interface per screen describing its whole in-progress form. The pages moved to
// individual `useState` calls, so none of them was referenced any more; they were removed rather
// than left to drift out of step with the forms they described.
