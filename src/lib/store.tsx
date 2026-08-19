import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Account, AccountType, Activity, Cheque, JournalEntry, Role, SettlementMethod, Stocks } from './types'
import { ACCOUNT_TYPES } from './types'
import { seedAccounts, seedActivity, seedCheques, seedJournalEntries, seedStocks } from './seed'
import { buyCalc, chequeNoError, nextChequeNumber, sellCalc, stk } from './engine'

const STORE_KEY = 'currencydesk.state.v1'

interface PersistShape {
  accounts: Account[]
  activity: Activity[]
  cheques: Cheque[]
  journalEntries: JournalEntry[]
  stocks: Stocks
  nextId: number
  nextJnlNo: number
  nextChequeNo: number
  role: Role
  userName: string
}

function seedState(): PersistShape {
  return {
    accounts: seedAccounts(),
    activity: seedActivity(),
    cheques: seedCheques(),
    journalEntries: seedJournalEntries(),
    stocks: seedStocks(),
    nextId: 100,
    nextJnlNo: 2,
    nextChequeNo: 4200,
    role: 'admin',
    userName: 'Admin',
  }
}

function loadState(): PersistShape {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return seedState()
    const saved = JSON.parse(raw)
    return { ...seedState(), ...saved }
  } catch {
    return seedState()
  }
}

export interface AppState extends PersistShape {
  loggedIn: boolean
}

interface StoreCtx {
  state: AppState
  isAdmin: boolean
  actor: string

  login: (role: Role, userName?: string) => void
  logout: () => void
  setRole: (role: Role) => void
  resetDemoData: () => void

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
  ) => string // '' on success, error message otherwise
  deleteAccount: (id: string) => string

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
  }) => { ok: boolean; error?: string }
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
  }) => { ok: boolean; error?: string }
  confirmReceive: (input: { customerId: string; amount: number; method: SettlementMethod; bankId: string; chqNo: string; chqBank: string }) => { ok: boolean; error?: string }
  confirmPay: (input: { customerId: string; amount: number; method: SettlementMethod; bankId: string; chqNo: string; chqBank: string }) => { ok: boolean; error?: string }

  postJournal: (input: { debitAccount: string; debitAmount: number; creditAccount: string; creditAmount: number; narration: string }) => string

  depositCheque: (id: string) => void
  clearCheque: (id: string) => void
  returnCheque: (id: string) => void

  accrueSalary: (empId: string, period: string) => string
  accrueAllSalaries: (period: string) => string
  paySalary: (empId: string, bankId: string) => string
  payAllSalaries: (bankId: string) => string
  salaryStats: (empId: string) => { accrued: number; paid: number; outstanding: number; periods: string[] }
}

const Ctx = createContext<StoreCtx | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [persisted, setPersisted] = useState<PersistShape>(() => loadState())
  const [loggedIn, setLoggedIn] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(persisted))
    } catch {
      /* ignore quota errors */
    }
  }, [persisted])

  const state: AppState = { ...persisted, loggedIn }
  const isAdmin = persisted.role !== 'user'
  const actor = persisted.userName || (isAdmin ? 'Admin' : 'Operations user')

  const stamp = () => {
    const t = new Date().toISOString()
    return { createdAt: t, createdBy: actor, updatedAt: t, updatedBy: actor }
  }

  const getAccount = (id?: string | null) => (id ? persisted.accounts.find((a) => a.id === id) : undefined)
  const customers = () => persisted.accounts.filter((a) => a.type === 'Customer')
  const employees = () => persisted.accounts.filter((a) => a.type === 'Employee')

  const accountHasActivity = (id: string) =>
    persisted.activity.some((t) => t.customerId === id) ||
    persisted.cheques.some((q) => q.customerId === id) ||
    persisted.journalEntries.some((e) => e.debitAccount === id || e.creditAccount === id)

  const typeLockedFor = (a?: Account) => !!a && (!!a.system || accountHasActivity(a.id))
  const typeLockReason = (a?: Account) => {
    if (!a) return ''
    if (a.system) return 'Type is locked — this is a built-in system account.'
    if (accountHasActivity(a.id)) return 'Type is locked — this account has transaction history.'
    return ''
  }

  const defaultBankId = () => persisted.accounts.find((a) => a.type === 'Bank')?.id || 'bank'
  const settlementIdFor = (method: SettlementMethod, bankId: string) => {
    if (method === 'Cash') return 'cash'
    if (method === 'Bank' || method === 'Cheque') return bankId || defaultBankId()
    return ''
  }
  const settlementName = (id: string) => getAccount(id)?.name || '—'

  function buildCheque(opts: { direction: 'Inward' | 'Outward'; party: string; customerId: string | null; amount: number; chqNo: string; chqBank: string; source: string; bankAccountId: string }, cheques: Cheque[], nextChequeNo: number): Cheque {
    const number = opts.chqNo.trim() || String(nextChequeNumber(cheques, nextChequeNo))
    const due = new Date()
    due.setDate(due.getDate() + 14)
    return {
      id: 'q' + Math.random().toString(36).slice(2, 9),
      direction: opts.direction,
      number,
      party: opts.party,
      customerId: opts.customerId,
      bank: opts.chqBank.trim() || settlementName(opts.bankAccountId),
      bankAccountId: opts.bankAccountId,
      amount: opts.amount,
      due: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      status: 'Pending',
      ledgerApplied: false,
      history: ['Recorded ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })],
      source: opts.source,
      ...stamp(),
    }
  }

  const ctx: StoreCtx = {
    state,
    isAdmin,
    actor,

    login: (role, userName) => {
      setPersisted((s) => ({ ...s, role, userName: (userName || '').trim() || (role === 'user' ? 'Operations user' : 'Admin') }))
      setLoggedIn(true)
    },
    logout: () => setLoggedIn(false),
    setRole: (role) => setPersisted((s) => ({ ...s, role })),
    resetDemoData: () => {
      try {
        window.localStorage.removeItem(STORE_KEY)
      } catch {
        /* ignore */
      }
      setPersisted(seedState())
    },

    getAccount,
    customers,
    employees,
    accountHasActivity,
    typeLockedFor,
    typeLockReason,

    saveAccount: (mode, id, form) => {
      const name = form.name.trim()
      if (!name) return 'Enter an account name.'
      if (persisted.accounts.some((a) => a.id !== id && a.name.toLowerCase() === name.toLowerCase())) return `${name} already exists.`

      if (mode === 'edit') {
        const prev = getAccount(id)
        if (!prev) return 'That account no longer exists.'
        const typeChanged = prev.type !== form.type
        if (typeChanged && prev.system) return "A system account's type cannot be changed."
        if (typeChanged && !form.typeOverride && typeLockedFor(prev)) return typeLockReason(prev)
        if (typeChanged && prev.type === 'Customer' && ((prev.receivable || 0) !== 0 || (prev.payable || 0) !== 0)) {
          return `${prev.name} still carries an open receivable or payable. Settle the balance before changing the type.`
        }
        setPersisted((s) => {
          const accounts = s.accounts.map((a) =>
            a.id !== id
              ? a
              : {
                  ...a,
                  name,
                  type: form.type,
                  phone: form.phone.trim() || '—',
                  city: form.city.trim() || '—',
                  notes: form.notes.trim(),
                  bankName: form.bankName.trim(),
                  accountNo: form.accountNo.trim(),
                  category: form.category.trim(),
                  designation: form.designation.trim(),
                  monthlySalary: parseFloat(form.monthlySalary) || 0,
                  code: form.code.trim() || 'AED',
                  updatedAt: new Date().toISOString(),
                  updatedBy: actor,
                  ...(typeChanged ? { typeChangedFrom: prev.type, typeChangedBy: actor, typeChangedAt: new Date().toISOString() } : {}),
                },
          )
          const renamed = accounts.find((a) => a.id === id)!
          const journalEntries = s.journalEntries.map((e) => ({
            ...e,
            debitLabel: e.debitAccount === id ? renamed.name : e.debitLabel,
            creditLabel: e.creditAccount === id ? renamed.name : e.creditLabel,
          }))
          const activity = s.activity.map((t) => (t.customerId === id ? { ...t, customerName: renamed.name } : t))
          const cheques = s.cheques.map((q) => (q.customerId === id ? { ...q, party: renamed.name } : q))
          return { ...s, accounts, journalEntries, activity, cheques }
        })
        return ''
      }

      const newId = (form.type === 'Customer' ? 'c' : 'a') + persisted.nextId
      const opening = form.type === 'Customer' || form.type === 'Payable' || form.type === 'Bank' || form.type === 'Cash' ? parseFloat(form.opening) || 0 : 0
      const now = new Date()
      const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const acct: Account = {
        id: newId,
        type: form.type,
        name,
        notes: form.notes.trim(),
        since: MONTHS[now.getMonth()] + ' ' + now.getFullYear(),
        ...stamp(),
      }
      if (form.type === 'Customer' || form.type === 'Employee') {
        acct.phone = form.phone.trim() || '—'
        acct.city = form.city.trim() || '—'
      }
      if (form.type === 'Customer') {
        acct.receivable = opening > 0 ? opening : 0
        acct.payable = opening < 0 ? -opening : 0
        acct.openingReceivable = acct.receivable
        acct.openingPayable = acct.payable
        if (opening) acct.openingPosted = true
      }
      if (form.type === 'Bank') {
        acct.bankName = form.bankName.trim()
        acct.accountNo = form.accountNo.trim()
      }
      if (form.type === 'Expense') acct.category = form.category.trim()
      if (form.type === 'Employee') acct.monthlySalary = parseFloat(form.monthlySalary) || 0
      if (form.type === 'Currency Stock') acct.code = form.code.trim() || 'AED'

      let entry: JournalEntry | null = null
      if (opening) {
        const capital = getAccount('capital')!
        const owedToUs = form.type === 'Payable' ? false : opening > 0
        const drId = owedToUs ? newId : 'capital'
        const crId = owedToUs ? 'capital' : newId
        entry = {
          id: 'j' + persisted.nextJnlNo,
          ref: 'JV-' + String(persisted.nextJnlNo).padStart(3, '0'),
          narration: 'Opening balance — ' + name,
          openingFor: newId,
          debitAccount: drId,
          creditAccount: crId,
          debitLabel: owedToUs ? name : capital.name,
          creditLabel: owedToUs ? capital.name : name,
          amount: Math.abs(opening),
          ...stamp(),
        }
      }

      setPersisted((s) => ({
        ...s,
        accounts: [...s.accounts, acct],
        nextId: s.nextId + 1,
        journalEntries: entry ? [entry, ...s.journalEntries] : s.journalEntries,
        nextJnlNo: entry ? s.nextJnlNo + 1 : s.nextJnlNo,
      }))
      return ''
    },

    deleteAccount: (id) => {
      const a = getAccount(id)
      if (!a || a.system) return "This account can't be deleted."
      if (accountHasActivity(id)) return "This account has transactions posted against it and can't be deleted."
      setPersisted((s) => ({ ...s, accounts: s.accounts.filter((x) => x.id !== id) }))
      return ''
    },

    confirmPurchase: (input) => {
      const cust = getAccount(input.customerId)
      if (!cust) return { ok: false, error: 'Select a supplying customer.' }
      if (input.amount <= 0 || input.rate <= 0) return { ok: false, error: 'Enter a valid amount and rate greater than 0.' }
      if (input.method === 'Credit' && input.paidNow > 0) {
        return { ok: false, error: 'A credit purchase cannot carry an amount paid now — there is no settlement account to debit.' }
      }
      const chqErr = chequeNoError(persisted.cheques, input.paidNow > 0 ? input.method : '', input.chqNo)
      if (chqErr) return { ok: false, error: chqErr }

      const { amount, rate, pkrValue, paidNow, outstanding } = buyCalc(input.amount, input.rate, input.method, input.paidNow)
      const code = input.currency
      const cur = stk(persisted.stocks, code)
      const newAvail = cur.available + amount
      const newAvg = newAvail > 0 ? (cur.available * cur.avgCost + amount * rate) / newAvail : cur.avgCost
      const chequeHeld = input.method === 'Cheque' && paidNow > 0
      const ledgerOutstanding = chequeHeld ? pkrValue : outstanding

      const txn: Activity = {
        id: 't' + persisted.nextId,
        type: 'purchase',
        currency: code,
        customerId: input.customerId,
        customerName: cust.name,
        amount,
        rate,
        pkrValue,
        method: input.method,
        paidNow,
        outstanding: ledgerOutstanding,
        chequeHeld,
        settlementAccountId: settlementIdFor(input.method, input.bankId),
        ...stamp(),
      }
      const cheque = chequeHeld ? buildCheque({ direction: 'Outward', party: cust.name, customerId: input.customerId, amount: paidNow, chqNo: input.chqNo, chqBank: input.chqBank, source: 'purchase', bankAccountId: input.bankId }, persisted.cheques, persisted.nextChequeNo) : null
      if (cheque) txn.chequeId = cheque.id

      setPersisted((s) => ({
        ...s,
        accounts: s.accounts.map((c) => (c.id === input.customerId ? { ...c, payable: (c.payable || 0) + ledgerOutstanding } : c)),
        stocks: { ...s.stocks, [code]: { available: newAvail, avgCost: newAvg } },
        activity: [txn, ...s.activity],
        nextId: s.nextId + 1,
        cheques: cheque ? [cheque, ...s.cheques] : s.cheques,
        nextChequeNo: cheque ? Math.max(s.nextChequeNo + 1, (parseInt(cheque.number, 10) || 0) + 1) : s.nextChequeNo,
      }))
      return { ok: true }
    },

    confirmSale: (input) => {
      const cust = getAccount(input.customerId)
      if (!cust) return { ok: false, error: 'Select a customer.' }
      if (input.amount <= 0 || input.rate <= 0) return { ok: false, error: 'Enter a valid amount and rate greater than 0.' }
      const avail = stk(persisted.stocks, input.currency).available
      if (input.amount > avail) return { ok: false, error: `Cannot sell more than available ${input.currency} stock (${avail.toLocaleString('en-US')} ${input.currency}).` }
      if (input.method === 'Credit' && input.paidNow > 0) {
        return { ok: false, error: 'A credit sale cannot carry an amount received now — there is no settlement account to debit.' }
      }
      const chqErr = chequeNoError(persisted.cheques, input.paidNow > 0 ? input.method : '', input.chqNo)
      if (chqErr) return { ok: false, error: chqErr }

      const avgCost = stk(persisted.stocks, input.currency).avgCost
      const { amount, rate, saleValue, cost, margin, paidNow, outstanding } = sellCalc(input.amount, input.rate, avgCost, input.method, input.paidNow)
      const chequeHeld = input.method === 'Cheque' && paidNow > 0
      const ledgerOutstanding = chequeHeld ? saleValue : outstanding

      const txn: Activity = {
        id: 't' + persisted.nextId,
        type: 'sale',
        currency: input.currency,
        customerId: input.customerId,
        customerName: cust.name,
        amount,
        rate,
        pkrValue: saleValue,
        cost,
        margin,
        method: input.method,
        paidNow,
        outstanding: ledgerOutstanding,
        chequeHeld,
        settlementAccountId: settlementIdFor(input.method, input.bankId),
        ...stamp(),
      }
      const cheque = chequeHeld ? buildCheque({ direction: 'Inward', party: cust.name, customerId: input.customerId, amount: paidNow, chqNo: input.chqNo, chqBank: input.chqBank, source: 'sale', bankAccountId: input.bankId }, persisted.cheques, persisted.nextChequeNo) : null
      if (cheque) txn.chequeId = cheque.id

      setPersisted((s) => ({
        ...s,
        accounts: s.accounts.map((c) => (c.id === input.customerId ? { ...c, receivable: (c.receivable || 0) + ledgerOutstanding } : c)),
        stocks: { ...s.stocks, [input.currency]: { available: stk(s.stocks, input.currency).available - amount, avgCost: stk(s.stocks, input.currency).avgCost } },
        activity: [txn, ...s.activity],
        nextId: s.nextId + 1,
        cheques: cheque ? [cheque, ...s.cheques] : s.cheques,
        nextChequeNo: cheque ? Math.max(s.nextChequeNo + 1, (parseInt(cheque.number, 10) || 0) + 1) : s.nextChequeNo,
      }))
      return { ok: true }
    },

    confirmReceive: (input) => {
      const cust = getAccount(input.customerId)
      if (!cust) return { ok: false, error: 'Select a customer.' }
      if (input.amount <= 0 || input.amount > (cust.receivable || 0)) return { ok: false, error: 'Enter an amount between 1 and the outstanding receivable.' }
      const chqErr = chequeNoError(persisted.cheques, input.method, input.chqNo)
      if (chqErr) return { ok: false, error: chqErr }

      const chequeHeld = input.method === 'Cheque'
      const txn: Activity = {
        id: 't' + persisted.nextId,
        type: 'receive',
        customerId: input.customerId,
        customerName: cust.name,
        amount: input.amount,
        pkrValue: input.amount,
        method: input.method,
        chequeHeld,
        settlementAccountId: settlementIdFor(input.method, input.bankId),
        ...stamp(),
      }
      const cheque = chequeHeld ? buildCheque({ direction: 'Inward', party: cust.name, customerId: input.customerId, amount: input.amount, chqNo: input.chqNo, chqBank: input.chqBank, source: 'payment in', bankAccountId: input.bankId }, persisted.cheques, persisted.nextChequeNo) : null
      if (cheque) txn.chequeId = cheque.id

      setPersisted((s) => ({
        ...s,
        accounts: chequeHeld ? s.accounts : s.accounts.map((c) => (c.id === input.customerId ? { ...c, receivable: (c.receivable || 0) - input.amount } : c)),
        activity: [txn, ...s.activity],
        nextId: s.nextId + 1,
        cheques: cheque ? [cheque, ...s.cheques] : s.cheques,
        nextChequeNo: cheque ? Math.max(s.nextChequeNo + 1, (parseInt(cheque.number, 10) || 0) + 1) : s.nextChequeNo,
      }))
      return { ok: true }
    },

    confirmPay: (input) => {
      const cust = getAccount(input.customerId)
      if (!cust) return { ok: false, error: 'Select a customer.' }
      if (input.amount <= 0 || input.amount > (cust.payable || 0)) return { ok: false, error: 'Enter an amount between 1 and the outstanding payable.' }
      const chqErr = chequeNoError(persisted.cheques, input.method, input.chqNo)
      if (chqErr) return { ok: false, error: chqErr }

      const chequeHeld = input.method === 'Cheque'
      const txn: Activity = {
        id: 't' + persisted.nextId,
        type: 'pay',
        customerId: input.customerId,
        customerName: cust.name,
        amount: input.amount,
        pkrValue: input.amount,
        method: input.method,
        chequeHeld,
        settlementAccountId: settlementIdFor(input.method, input.bankId),
        ...stamp(),
      }
      const cheque = chequeHeld ? buildCheque({ direction: 'Outward', party: cust.name, customerId: input.customerId, amount: input.amount, chqNo: input.chqNo, chqBank: input.chqBank, source: 'payment out', bankAccountId: input.bankId }, persisted.cheques, persisted.nextChequeNo) : null
      if (cheque) txn.chequeId = cheque.id

      setPersisted((s) => ({
        ...s,
        accounts: chequeHeld ? s.accounts : s.accounts.map((c) => (c.id === input.customerId ? { ...c, payable: (c.payable || 0) - input.amount } : c)),
        activity: [txn, ...s.activity],
        nextId: s.nextId + 1,
        cheques: cheque ? [cheque, ...s.cheques] : s.cheques,
        nextChequeNo: cheque ? Math.max(s.nextChequeNo + 1, (parseInt(cheque.number, 10) || 0) + 1) : s.nextChequeNo,
      }))
      return { ok: true }
    },

    postJournal: (input) => {
      if (!input.debitAccount || !input.creditAccount) return 'Select an account on both the debit and the credit line.'
      if (input.debitAccount === input.creditAccount) {
        const a = getAccount(input.debitAccount)
        return `A journal entry can't debit and credit the same account${a ? ' (' + a.name + ')' : ''}.`
      }
      if (input.debitAmount <= 0 || input.creditAmount <= 0) return 'Enter a debit and a credit amount greater than 0.'
      if (input.debitAmount !== input.creditAmount) return `Entry is out of balance — total debit and total credit must match.`

      const entry: JournalEntry = {
        id: 'j' + persisted.nextJnlNo,
        ref: 'JV-' + String(persisted.nextJnlNo).padStart(3, '0'),
        narration: input.narration.trim() || 'Journal entry',
        debitLabel: settlementName(input.debitAccount),
        creditLabel: settlementName(input.creditAccount),
        debitAccount: input.debitAccount,
        creditAccount: input.creditAccount,
        amount: input.debitAmount,
        ...stamp(),
      }
      setPersisted((s) => ({ ...s, journalEntries: [entry, ...s.journalEntries], nextJnlNo: s.nextJnlNo + 1 }))
      return ''
    },

    depositCheque: (id) =>
      setPersisted((s) => ({
        ...s,
        cheques: s.cheques.map((q) => (q.id === id && q.status === 'Pending' ? { ...q, status: 'Deposited', updatedAt: new Date().toISOString(), updatedBy: actor, history: [...q.history, 'Deposited ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })] } : q)),
      })),

    clearCheque: (id) =>
      setPersisted((s) => {
        const q = s.cheques.find((x) => x.id === id)
        if (!q || q.status !== 'Deposited') return s
        const accounts = q.customerId
          ? s.accounts.map((c) =>
              c.id === q.customerId
                ? q.direction === 'Inward'
                  ? { ...c, receivable: (c.receivable || 0) - q.amount }
                  : { ...c, payable: (c.payable || 0) - q.amount }
                : c,
            )
          : s.accounts
        return {
          ...s,
          accounts,
          cheques: s.cheques.map((x) =>
            x.id === id ? { ...x, status: 'Cleared', ledgerApplied: true, updatedAt: new Date().toISOString(), updatedBy: actor, history: [...x.history, 'Cleared ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })] } : x,
          ),
        }
      }),

    returnCheque: (id) =>
      setPersisted((s) => ({
        ...s,
        cheques: s.cheques.map((q) => (q.id === id && q.status === 'Deposited' ? { ...q, status: 'Returned', updatedAt: new Date().toISOString(), updatedBy: actor, history: [...q.history, 'Returned ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })] } : q)),
      })),

    salaryStats: (empId) => {
      const es = persisted.journalEntries.filter((e) => e.salary?.employeeId === empId)
      const accrued = es.filter((e) => e.salary?.kind === 'accrual').reduce((a, e) => a + e.amount, 0)
      const paid = es.filter((e) => e.salary?.kind === 'payment').reduce((a, e) => a + e.amount, 0)
      const periods = es.filter((e) => e.salary?.kind === 'accrual').map((e) => e.salary!.period)
      return { accrued, paid, outstanding: accrued - paid, periods }
    },

    accrueSalary: (empId, period) => {
      const emp = getAccount(empId)
      if (!emp || emp.type !== 'Employee') return ''
      if (!(emp.monthlySalary! > 0)) return `${emp.name} has no monthly salary on file — set it on the account first.`
      if (ctx.salaryStats(empId).periods.includes(period)) return `${period} is already accrued for ${emp.name}.`
      const entry: JournalEntry = {
        id: 'j' + persisted.nextJnlNo,
        ref: 'JV-' + String(persisted.nextJnlNo).padStart(3, '0'),
        narration: `Salary accrual ${period} — ${emp.name}`,
        debitAccount: 'salaryExpense',
        creditAccount: 'salaryPayable',
        debitLabel: 'Salary Expense',
        creditLabel: 'Salary Payable',
        amount: emp.monthlySalary!,
        salary: { employeeId: empId, period, kind: 'accrual' },
        ...stamp(),
      }
      setPersisted((s) => ({ ...s, journalEntries: [entry, ...s.journalEntries], nextJnlNo: s.nextJnlNo + 1 }))
      return ''
    },

    accrueAllSalaries: (period) => {
      const pending = employees().filter((e) => (e.monthlySalary || 0) > 0 && !ctx.salaryStats(e.id).periods.includes(period))
      if (!employees().length) return 'No employee accounts yet — add one from Accounts with type Employee.'
      if (!pending.length) return `Every employee with a salary on file is already accrued for ${period}.`
      const entries: JournalEntry[] = pending.map((emp, i) => ({
        id: 'j' + (persisted.nextJnlNo + i),
        ref: 'JV-' + String(persisted.nextJnlNo + i).padStart(3, '0'),
        narration: `Salary accrual ${period} — ${emp.name}`,
        debitAccount: 'salaryExpense',
        creditAccount: 'salaryPayable',
        debitLabel: 'Salary Expense',
        creditLabel: 'Salary Payable',
        amount: emp.monthlySalary!,
        salary: { employeeId: emp.id, period, kind: 'accrual' },
        ...stamp(),
      }))
      setPersisted((s) => ({ ...s, journalEntries: [...entries, ...s.journalEntries], nextJnlNo: s.nextJnlNo + entries.length }))
      return ''
    },

    paySalary: (empId, bankId) => {
      const emp = getAccount(empId)
      if (!emp) return ''
      const out = ctx.salaryStats(empId).outstanding
      if (out <= 0) return `Nothing outstanding for ${emp.name}.`
      const entry: JournalEntry = {
        id: 'j' + persisted.nextJnlNo,
        ref: 'JV-' + String(persisted.nextJnlNo).padStart(3, '0'),
        narration: `Salary paid — ${emp.name} · from ${settlementName(bankId)}`,
        debitAccount: 'salaryPayable',
        creditAccount: bankId,
        debitLabel: 'Salary Payable',
        creditLabel: settlementName(bankId),
        amount: out,
        salary: { employeeId: empId, period: '', kind: 'payment' },
        ...stamp(),
      }
      setPersisted((s) => ({ ...s, journalEntries: [entry, ...s.journalEntries], nextJnlNo: s.nextJnlNo + 1 }))
      return ''
    },

    payAllSalaries: (bankId) => {
      const due = employees()
        .map((e) => ({ e, out: ctx.salaryStats(e.id).outstanding }))
        .filter((x) => x.out > 0)
      if (!due.length) return 'No unpaid salary balance to settle.'
      const entries: JournalEntry[] = due.map((x, i) => ({
        id: 'j' + (persisted.nextJnlNo + i),
        ref: 'JV-' + String(persisted.nextJnlNo + i).padStart(3, '0'),
        narration: `Salary paid — ${x.e.name} · from ${settlementName(bankId)}`,
        debitAccount: 'salaryPayable',
        creditAccount: bankId,
        debitLabel: 'Salary Payable',
        creditLabel: settlementName(bankId),
        amount: x.out,
        salary: { employeeId: x.e.id, period: '', kind: 'payment' },
        ...stamp(),
      }))
      setPersisted((s) => ({ ...s, journalEntries: [...entries, ...s.journalEntries], nextJnlNo: s.nextJnlNo + entries.length }))
      return ''
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
