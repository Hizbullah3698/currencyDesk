// The actual accounting math lives in the shared @currencydesk/engine package (used by both
// this frontend and the backend) so the two never drift apart. This file exists only so the
// many existing `from './engine'` imports across the app don't all need to change.
export * from '@currencydesk/engine'
