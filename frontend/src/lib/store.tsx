import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Account, AccountType, Activity, Cheque, JournalEntry, SettlementMethod, Stocks } from './types'
import { ACCOUNT_TYPES } from './types'
import { CORE_ACCOUNT_IDS } from './engine'
import { useAuth } from './auth'
import { apiUrl } from './apiBase'

export interface AppState {
  accounts: Account[]
  activity: Activity[]
  cheques: Cheque[]
  journalEntries: JournalEntry[]
  stocks: Stocks
}

const EMPTY_STATE: AppState = { accounts: [], activity: [], cheques: [], journalEntries: [], stocks: {} }

// Matches auth.tsx's AuthStatus naming convention — the same "what phase is this async data in"
// modeling, one level down (business data instead of identity). No 'unreachable' distinction
// here: a failed fetch of any kind (network failure, session expiry, a real server error) is
// just 'error' with a message, since the recovery action (retry) is the same either way.
export type StoreStatus = 'loading' | 'ready' | 'error'

async function parseJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

type ApiResult = { ok: true; snapshot: AppState } | { ok: false; error: string }

async function apiCall(method: string, url: string, body?: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(apiUrl(url), {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const json = await parseJson(res)
    // The Express backend's own global error handler always responds with real {error: string}
    // JSON on failure — so a response with no parseable `error` field never actually came from
    // our app at all. In local dev this is exactly what Vite's proxy returns (an empty-bodied
    // 502) when the backend process isn't running, so "could not reach the server" is the
    // accurate read of that case, not a vague fallback.
    if (!res.ok) return { ok: false, error: json?.error || 'Could not reach the server.' }
    return { ok: true, snapshot: json as AppState }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}

interface StoreCtx {
  status: StoreStatus
  loadError: string | null
  refetch: () => Promise<void>

  state: AppState
  isAdmin: boolean
  actor: string

  getAccount: (id?: string | null) => Account | undefined
  customers: () => Account[]
  employees: () => Account[]
  accountHasActivity: (id: string) => boolean
  typeLockedFor: (a?: Account) => boolean
  typeLockReason: (a?: Account) => string

  saveAccount: (
    mode: 'new' | 'edit',
    id: string,
    form: {
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
      typeOverride: boolean
    },
  ) => Promise<string> // '' on success, error message otherwise
  deleteAccount: (id: string) => Promise<string>
  archiveAccount: (id: string) => Promise<string>
  unarchiveAccount: (id: string) => Promise<string>

  confirmPurchase: (input: {
    customerId: string
    currency: string
    amount: number
    rate: number
    method: SettlementMethod
    paidNow: number
    bankId: string
    chqNo: string
    chqBank: string
  }) => Promise<{ ok: boolean; error?: string }>
  confirmSale: (input: {
    customerId: string
    currency: string
    amount: number
    rate: number
    method: SettlementMethod
    paidNow: number
    bankId: string
    chqNo: string
    chqBank: string
  }) => Promise<{ ok: boolean; error?: string }>
  confirmReceive: (input: { customerId: string; amount: number; method: SettlementMethod; bankId: string; chqNo: string; chqBank: string }) => Promise<{ ok: boolean; error?: string }>
  confirmPay: (input: { customerId: string; amount: number; method: SettlementMethod; bankId: string; chqNo: string; chqBank: string }) => Promise<{ ok: boolean; error?: string }>

  postJournal: (input: { debitAccount: string; debitAmount: number; creditAccount: string; creditAmount: number; narration: string }) => Promise<string>

  depositCheque: (id: string) => Promise<string>
  clearCheque: (id: string) => Promise<string>
  returnCheque: (id: string) => Promise<string>

  accrueSalary: (empId: string, period: string) => Promise<string>
  accrueAllSalaries: (period: string) => Promise<string>
  paySalary: (empId: string, bankId: string) => Promise<string>
  payAllSalaries: (bankId: string) => Promise<string>
  salaryStats: (empId: string) => { accrued: number; paid: number; outstanding: number; periods: string[] }
}

const Ctx = createContext<StoreCtx | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, status: authStatus } = useAuth()
  const [state, setState] = useState<AppState>(EMPTY_STATE)
  const [status, setStatus] = useState<StoreStatus>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)

  const applyResult = (result: ApiResult): { ok: boolean; error?: string } => {
    if (result.ok) {
      setState(result.snapshot)
      return { ok: true }
    }
    return { ok: false, error: result.error }
  }

  // Background refetch — used on navigation, and callable directly (e.g. a "Retry" button after
  // a load failure). Deliberately does NOT flip `status` back to 'loading' on every call: only
  // the very first load should show the full-page loading screen. A failure here (session
  // expired mid-use, the server going down) does flip `status` to 'error', since at that point
  // there's no guarantee `state` is still trustworthy to keep showing silently.
  const refetch = useCallback(async () => {
    const result = await apiCall('GET', '/api/state')
    if (result.ok) {
      setState(result.snapshot)
      setStatus('ready')
      setLoadError(null)
    } else {
      setStatus('error')
      setLoadError(result.error)
    }
  }, [])

  useEffect(() => {
    if (authStatus === 'authenticated') {
      setStatus('loading')
      setLoadError(null)
      apiCall('GET', '/api/state').then((result) => {
        if (result.ok) {
          setState(result.snapshot)
          setStatus('ready')
        } else {
          setStatus('error')
          setLoadError(result.error)
        }
      })
    } else {
      // Signed out (or session still being checked) — don't keep a previous user's business
      // data sitting in memory; a fresh sign-in always re-fetches from scratch.
      setState(EMPTY_STATE)
      setStatus('loading')
      setLoadError(null)
    }
  }, [authStatus])

  const isAdmin = user?.role !== 'user'
  const actor = user?.displayName || user?.email || 'Unknown user'

  const getAccount = (id?: string | null) => (id ? state.accounts.find((a) => a.id === id) : undefined)
  const customers = () => state.accounts.filter((a) => a.type === 'Customer')
  const employees = () => state.accounts.filter((a) => a.type === 'Employee')

  const accountHasActivity = (id: string) =>
    state.activity.some((t) => t.customerId === id) || state.cheques.some((q) => q.customerId === id) || state.journalEntries.some((e) => e.debitAccount === id || e.creditAccount === id)

  const typeLockedFor = (a?: Account) => !!a && (CORE_ACCOUNT_IDS.includes(a.id) || accountHasActivity(a.id))
  const typeLockReason = (a?: Account) => {
    if (!a) return ''
    if (CORE_ACCOUNT_IDS.includes(a.id)) return "Type is locked — other parts of the app depend on this account by id."
    if (accountHasActivity(a.id)) return 'Type is locked — this account has transaction history.'
    return ''
  }

  // Every mutating action funnels through one of these two — both apply a successful response's
  // fresh snapshot to `state` (the server's response is always the source of truth; nothing here
  // computes or guesses a result locally), and both leave `status`/`state` untouched on failure
  // so a single failed action never blanks out the rest of the app's already-loaded data.
  async function mutateString(method: string, url: string, body?: unknown): Promise<string> {
    const result = await apiCall(method, url, body)
    if (result.ok) {
      setState(result.snapshot)
      return ''
    }
    return result.error
  }
  async function mutateResult(method: string, url: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
    return applyResult(await apiCall(method, url, body))
  }

  const ctx: StoreCtx = {
    status,
    loadError,
    refetch,

    state,
    isAdmin,
    actor,

    getAccount,
    customers,
    employees,
    accountHasActivity,
    typeLockedFor,
    typeLockReason,

    saveAccount: (mode, id, form) => (mode === 'new' ? mutateString('POST', '/api/accounts', form) : mutateString('PATCH', `/api/accounts/${id}`, form)),
    deleteAccount: (id) => mutateString('DELETE', `/api/accounts/${id}`),
    archiveAccount: (id) => mutateString('POST', `/api/accounts/${id}/archive`),
    unarchiveAccount: (id) => mutateString('POST', `/api/accounts/${id}/unarchive`),

    confirmPurchase: (input) => mutateResult('POST', '/api/trades/purchase', input),
    confirmSale: (input) => mutateResult('POST', '/api/trades/sale', input),
    confirmReceive: (input) => mutateResult('POST', '/api/settlements/receive', input),
    confirmPay: (input) => mutateResult('POST', '/api/settlements/pay', input),

    postJournal: (input) => mutateString('POST', '/api/journal', input),

    depositCheque: (id) => mutateString('POST', `/api/cheques/${id}/deposit`),
    clearCheque: (id) => mutateString('POST', `/api/cheques/${id}/clear`),
    returnCheque: (id) => mutateString('POST', `/api/cheques/${id}/return`),

    accrueSalary: (empId, period) => mutateString('POST', '/api/salary/accrue', { employeeId: empId, period }),
    accrueAllSalaries: (period) => mutateString('POST', '/api/salary/accrue-all', { period }),
    paySalary: (empId, bankId) => mutateString('POST', '/api/salary/pay', { employeeId: empId, bankId }),
    payAllSalaries: (bankId) => mutateString('POST', '/api/salary/pay-all', { bankId }),

    salaryStats: (empId) => {
      const es = state.journalEntries.filter((e) => e.salary?.employeeId === empId)
      const accrued = es.filter((e) => e.salary?.kind === 'accrual').reduce((a, e) => a + e.amount, 0)
      const paid = es.filter((e) => e.salary?.kind === 'payment').reduce((a, e) => a + e.amount, 0)
      const periods = es.filter((e) => e.salary?.kind === 'accrual').map((e) => e.salary!.period)
      return { accrued, paid, outstanding: accrued - paid, periods }
    },
  }

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
}

export function useStore(): StoreCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}

export { ACCOUNT_TYPES }
