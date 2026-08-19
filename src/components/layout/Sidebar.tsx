import { NavLink } from 'react-router-dom'
import { LayoutDashboard, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Banknote, SquarePen, Lock, Users2, Wallet, UserRound, List, Landmark, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store'
import { Logo } from './Logo'

interface NavItemDef {
  to: string
  label: string
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>
  adminOnly?: boolean
}

const OVERVIEW: NavItemDef[] = [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }]

const TRANSACTIONS: NavItemDef[] = [
  { to: '/purchase', label: 'Currency Purchase', icon: ArrowDownToLine },
  { to: '/sale', label: 'Currency Sale', icon: ArrowUpFromLine },
  { to: '/payments', label: 'Payments', icon: ArrowLeftRight },
  { to: '/cheques', label: 'Cheques', icon: Banknote },
  { to: '/journal', label: 'Journal Entry', icon: SquarePen, adminOnly: true },
  { to: '/salary', label: 'Salary', icon: Users2, adminOnly: true },
]

const BOOKS: NavItemDef[] = [
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/customers', label: 'Customers', icon: UserRound },
  { to: '/transactions', label: 'Transactions', icon: List },
  { to: '/stock', label: 'Ledgers', icon: Landmark },
  { to: '/balance-sheet', label: 'Balance Sheet', icon: Landmark, adminOnly: true },
  { to: '/income-statement', label: 'Income Statement', icon: TrendingUp, adminOnly: true },
]

function NavGroup({ title, items, isAdmin }: { title: string; items: NavItemDef[]; isAdmin: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-70">{title}</div>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-[6px] px-2 py-2 text-[12.5px] no-underline whitespace-nowrap transition-colors',
              isActive ? 'bg-accent-bg font-semibold text-accent' : 'font-normal text-ink hover:bg-surface-tint',
              !isAdmin && item.adminOnly && 'opacity-60',
            )
          }
        >
          <item.icon size={15} strokeWidth={1.8} />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {!isAdmin && item.adminOnly && <Lock size={10} className="ml-auto flex-none text-muted-42" />}
        </NavLink>
      ))}
    </div>
  )
}

export function Sidebar() {
  const { state, isAdmin } = useStore()
  return (
    <aside className="sticky top-0 flex h-screen w-[214px] flex-none flex-col border-r border-border-strong bg-surface">
      <div className="flex h-[52px] flex-none items-center gap-2.5 border-b border-border px-3.5">
        <Logo />
        <div className="whitespace-nowrap text-[13.5px] font-semibold tracking-tight">Currency Desk</div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto p-2 pt-3.5 pb-[18px]">
        <NavGroup title="Overview" items={OVERVIEW} isAdmin={isAdmin} />
        <NavGroup title="Transactions" items={TRANSACTIONS} isAdmin={isAdmin} />
        <NavGroup title="Books" items={BOOKS} isAdmin={isAdmin} />
      </nav>

      <div className="flex-none border-t border-border px-3.5 py-2.5 text-[10.5px] text-muted-70">Signed in as {state.role === 'admin' ? 'Admin' : 'Operator'}</div>
    </aside>
  )
}
