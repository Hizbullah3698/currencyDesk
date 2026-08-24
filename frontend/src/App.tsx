import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
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
  return <div className="flex min-h-screen items-center justify-center bg-app text-[12.5px] text-muted-60">Loading…</div>
}

function ServerUnreachable() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-5">
      <div className="max-w-[360px] text-center text-[12.5px] leading-relaxed text-muted-70">
        Can't reach the server. Make sure the backend is running (<code className="tabular">npm run dev --prefix server</code>), then reload.
      </div>
    </div>
  )
}

function Gate() {
  // Reads the 3-way auth status directly, not via useStore()'s derived `loggedIn` boolean —
  // that boolean collapses 'checking' and 'anonymous' into the same `false` value, which would
  // flash the login screen for a returning user while their session is still being verified.
  const { status } = useAuth()
  if (status === 'checking') return <BootSplash />
  if (status === 'unreachable') return <ServerUnreachable />
  if (status === 'anonymous') return <Login />
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
