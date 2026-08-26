import { useEffect, useRef } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { StoreProvider, useStore } from '@/lib/store'
import { ThemeProvider } from '@/lib/theme'
import { AuthProvider, useAuth } from '@/lib/auth'
import { AppShell } from '@/components/layout/AppShell'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { Customers } from '@/pages/Customers'
import { CustomerDetail } from '@/pages/CustomerDetail'
import { Accounts } from '@/pages/Accounts'
import { Trade } from '@/pages/Trade'
import { Settle } from '@/pages/Settle'
import { Stock } from '@/pages/Stock'
import { Payments } from '@/pages/Payments'
import { Cheques } from '@/pages/Cheques'
import { Journal } from '@/pages/Journal'
import { Transactions } from '@/pages/Transactions'
import { BalanceSheet } from '@/pages/BalanceSheet'
import { IncomeStatement } from '@/pages/IncomeStatement'
import { Salary } from '@/pages/Salary'
import { Denied } from '@/pages/Denied'

function RequireAdmin({ children, label }: { children: React.ReactNode; label: string }) {
  const { isAdmin } = useStore()
  if (!isAdmin) return <Denied label={label} />
  return <>{children}</>
}

function BootSplash() {
  return <div className="flex min-h-screen items-center justify-center bg-app text-body text-muted-60">Loading…</div>
}

function ServerUnreachable() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-5">
      <div className="max-w-[360px] text-center text-body leading-relaxed text-muted-70">
        Can't reach the server. Make sure the backend is running (<code className="tabular">npm run dev</code> inside <code className="tabular">backend/</code>), then reload.
      </div>
    </div>
  )
}

function StoreLoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-5">
      <div className="flex max-w-[360px] flex-col items-center gap-3 text-center">
        <div className="text-body leading-relaxed text-muted-70">Couldn't load your data: {message}</div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-[6px] border border-border-strong bg-surface px-3 py-1.5 text-body font-semibold text-ink transition-colors duration-150 hover:bg-surface-tint"
        >
          Retry
        </button>
      </div>
    </div>
  )
}

function RoutedApp() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/purchase" element={<Trade key="buy" mode="buy" />} />
        <Route path="/sale" element={<Trade key="sell" mode="sell" />} />
        <Route path="/receive" element={<Settle key="receive" mode="receive" />} />
        <Route path="/pay" element={<Settle key="pay" mode="pay" />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/cheques" element={<Cheques />} />
        <Route
          path="/journal"
          element={
            <RequireAdmin label="Journal Entry">
              <Journal />
            </RequireAdmin>
          }
        />
        <Route
          path="/salary"
          element={
            <RequireAdmin label="the Salary run">
              <Salary />
            </RequireAdmin>
          }
        />
        <Route path="/transactions" element={<Transactions />} />
        <Route
          path="/balance-sheet"
          element={
            <RequireAdmin label="the Balance Sheet">
              <BalanceSheet />
            </RequireAdmin>
          }
        />
        <Route
          path="/income-statement"
          element={
            <RequireAdmin label="the Income Statement">
              <IncomeStatement />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppShell>
  )
}

function Gate() {
  // Reads the 3-way auth status directly, not via useStore()'s derived `loggedIn` boolean —
  // that boolean collapses 'checking' and 'anonymous' into the same `false` value, which would
  // flash the login screen for a returning user while their session is still being verified.
  const { status: authStatus } = useAuth()
  const { status: storeStatus, loadError, refetch } = useStore()
  const location = useLocation()
  const skippedFirst = useRef(false)

  // Refetch business data on every navigation (not just once at boot) — this is the app's whole
  // multi-tab/multi-user sync strategy: no websockets, no polling, just "the data is at most one
  // navigation stale." Skips the very first run so it doesn't duplicate the initial load
  // StoreProvider already triggers itself when auth resolves to 'authenticated'.
  useEffect(() => {
    if (authStatus !== 'authenticated') return
    if (!skippedFirst.current) {
      skippedFirst.current = true
      return
    }
    refetch()
  }, [location.pathname, authStatus, refetch])

  if (authStatus === 'checking') return <BootSplash />
  if (authStatus === 'unreachable') return <ServerUnreachable />
  if (authStatus === 'anonymous') return <Login />

  if (storeStatus === 'loading') return <BootSplash />
  if (storeStatus === 'error') return <StoreLoadFailed message={loadError || 'unknown error'} onRetry={refetch} />

  return <RoutedApp />
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <StoreProvider>
          <BrowserRouter>
            <Gate />
          </BrowserRouter>
        </StoreProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
