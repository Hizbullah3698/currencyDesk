import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { StoreProvider, useStore } from '@/lib/store'
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

function Gate() {
  const { state } = useStore()
  if (!state.loggedIn) return <Login />
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/purchase" element={<Trade mode="buy" />} />
        <Route path="/sale" element={<Trade mode="sell" />} />
        <Route path="/receive" element={<Settle mode="receive" />} />
        <Route path="/pay" element={<Settle mode="pay" />} />
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
    <StoreProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </StoreProvider>
  )
}
