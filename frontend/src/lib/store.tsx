import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Account, AccountType, Activity, Cheque, JournalEntry, SettlementMethod, Stocks } from './types'
import { ACCOUNT_TYPES } from './types'
import { useAuth } from './auth'
import { apiUrl } from './apiBase'
import { getCsrfToken, isCsrfError, isMutatingMethod, requestHeaders } from './csrf'
import { markActivity, markServerContact } from './activity'
import { refreshCsrfToken } from './authClient'
import { notifySessionExpired } from './sessionExpiry'

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
// here: a failed fetch of any kind (a network failure, a real server error) is just 'error' with
// a message, since the recovery action (retry) is the same either way.
//
// A 401 is the one failure that is NOT one of those, and is deliberately excluded: retrying it can
// only fail again, because the session it needed is gone. It routes to the login screen instead —
// see the `unauthenticated` flag on ApiResult and lib/sessionExpiry.ts.
export type StoreStatus = 'loading' | 'ready' | 'error'

async function parseJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

type ApiResult =
  | { ok: true; snapshot: AppState }
  | {
      ok: false
      error: string
      /** The session is gone. The caller must not present this as a retryable load failure —
       *  sign-out is already under way, and the app is about to render the login screen. */
      unauthenticated?: boolean
    }

async function sendRequest(method: string, url: string, body?: unknown): Promise<Response> {
  // Every request is both activity (someone asked for this) and server contact (the session's
  // rolling window just moved). Recording the latter is what stops the idle keepalive firing
  // redundantly alongside traffic the app was already making. See lib/activity.ts.
  markActivity()
  markServerContact()
  return fetch(apiUrl(url), {
    method,
    headers: requestHeaders(method),
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function apiCall(method: string, url: string, body?: unknown): Promise<ApiResult> {
  try {
    const mutating = isMutatingMethod(method)

    // A mutating request with no token in memory would be rejected once the server enforces
    // (rollout stage 3). Fetching one first turns that from a failed user action into a slightly
    // slower one. Only on the mutating path — a plain refetch never needs it.
    if (mutating && !getCsrfToken()) await refreshCsrfToken()

    let res = await sendRequest(method, url, body)
    let json = await parseJson(res)

    // Recover from a rejected token exactly once. Deliberately narrow: `isCsrfError` matches only
    // the server's own token messages, so a genuine "Admin access required" 403 is NOT retried —
    // retrying that would be pointless and would hide the real reason from the user.
    if (mutating && isCsrfError(res.status, json?.error)) {
      const refreshed = await refreshCsrfToken()
      if (refreshed) {
        res = await sendRequest(method, url, body)
        json = await parseJson(res)
      }
    }

    // A 401 is not a data-loading problem and must never be presented as one: the session is
    // gone, and no amount of retrying this request will bring it back. Raising the signal here —
    // once, centrally, for every GET and every mutation this app makes — is what turns it into a
    // trip to the login screen. See lib/sessionExpiry.ts.
    if (res.status === 401) {
      notifySessionExpired()
      return { ok: false, error: json?.error || 'Your session ended.', unauthenticated: true }
    }

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
  /** The set behind `accountHasActivity`, exposed so a memo can depend on a stable value rather
   * than on that function, which is a new closure every render. */
  inUseAccountIds: Set<string>

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
    /** 'YYYY-MM-DD' — the date the deal was struck (see Activity.txnDate in the engine types). */
    txnDate: string
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
    /** 'YYYY-MM-DD' — the date the deal was struck (see Activity.txnDate in the engine types). */
    txnDate: string
    amount: number
    rate: number
    method: SettlementMethod
    paidNow: number
    bankId: string
    chqNo: string
    chqBank: string
  }) => Promise<{ ok: boolean; error?: string }>
  confirmReceive: (input: {
    customerId: string
    /** 'YYYY-MM-DD' — the day the payment was actually made (see Activity.txnDate in the engine types). */
    txnDate: string
    amount: number
    method: SettlementMethod
    bankId: string
    chqNo: string
    chqBank: string
  }) => Promise<{ ok: boolean; error?: string }>
  confirmPay: (input: {
    customerId: string
    /** 'YYYY-MM-DD' — the day the payment was actually made (see Activity.txnDate in the engine types). */
    txnDate: string
    amount: number
    method: SettlementMethod
    bankId: string
    chqNo: string
    chqBank: string
  }) => Promise<{ ok: boolean; error?: string }>

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
      return
    }
    // A 401 has already raised the expiry signal, so AuthProvider is flipping to anonymous and
    // Gate is about to render the login screen. Setting an error here would put a dead-end
    // "Couldn't load your data" screen in front of that for a frame — the exact screen this
    // change exists to remove.
    if (result.unauthenticated) return
    setStatus('error')
    setLoadError(result.error)
  }, [])

  useEffect(() => {
    if (authStatus === 'authenticated') {
      setStatus('loading')
      setLoadError(null)
      apiCall('GET', '/api/state').then((result) => {
        if (result.ok) {
          setState(result.snapshot)
          setStatus('ready')
        } else if (!result.unauthenticated) {
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

  // Every account id anything points at — the client-side twin of accountHelpers.ts's
  // describeAccountReferences, over the SAME seven paths, so the screen and the server never
  // disagree about which accounts are in use. The three that are easy to forget, and that were
  // missing here until 2026-09-06: a trade's settlement account, a cheque's bank account, and a
  // salary posting's employee (a salary accrual posts Dr salaryExpense / Cr salaryPayable, so
  // the employee is never a leg and an employee with a year of payroll read as untouched).
  //
  // Built once per snapshot as a Set rather than scanned per account. The Accounts page now asks
  // this for every account on every render to decide what to show, which is O(accounts × rows)
  // as a per-id scan; it is also what makes the memo downstream able to depend on a stable value
  // instead of a fresh closure.
  //
  // An Operator's snapshot omits journal entries with an Income leg, so this can under-report for
  // an Income account on a non-admin screen. Harmless in practice: the only Income account is the
  // built-in 'margin', which is a system account and therefore neither hidden nor deletable.
  const inUseAccountIds = useMemo(() => {
    const ids = new Set<string>()
    for (const t of state.activity) {
      if (t.customerId) ids.add(t.customerId)
      if (t.settlementAccountId) ids.add(t.settlementAccountId)
    }
    for (const q of state.cheques) {
      if (q.customerId) ids.add(q.customerId)
      if (q.bankAccountId) ids.add(q.bankAccountId)
    }
    for (const e of state.journalEntries) {
      ids.add(e.debitAccount)
      ids.add(e.creditAccount)
      if (e.salary) ids.add(e.salary.employeeId)
      if (e.openingFor) ids.add(e.openingFor)
    }
    return ids
  }, [state.activity, state.cheques, state.journalEntries])

  const accountHasActivity = (id: string) => inUseAccountIds.has(id)

  // NOTE: `typeLockedFor` / `typeLockReason` lived here until 2026-09-07 and are deliberately
  // gone rather than left unused. They described a standing lock on the Edit Account form — a
  // badge plus an "Admin override" link, both permanently on screen whether or not anyone
  // intended to retype anything. That is now a confirmation asked at the moment of change
  // (AccountFormModal's `pickType`), so a helper still phrasing it as a lock would only invite
  // the banner back. The two facts they combined are still enforced, separately and where they
  // belong: CORE_ACCOUNT_IDS disables the buttons outright (the API and migration 009's trigger
  // refuse a core retype regardless), and `accountHasActivity` decides whether a change needs
  // confirming.

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
    inUseAccountIds,

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
