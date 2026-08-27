import { NavLink } from 'react-router-dom'
import { LayoutDashboard, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Banknote, SquarePen, Lock, Users2, Wallet, UserRound, List, Coins, Landmark, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store'
import { SIDEBAR_CATEGORY_COLORS, type Category } from '@/lib/ui-helpers'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Logo } from './Logo'

interface NavItemDef {
  to: string
  label: string
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>
  category: Category
  adminOnly?: boolean
}

const OVERVIEW: NavItemDef[] = [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, category: 'neutral' }]

const TRANSACTIONS: NavItemDef[] = [
  { to: '/purchase', label: 'Currency Purchase', icon: ArrowDownToLine, category: 'fx' },
  { to: '/sale', label: 'Currency Sale', icon: ArrowUpFromLine, category: 'fx' },
  { to: '/payments', label: 'Payments', icon: ArrowLeftRight, category: 'customers' },
  { to: '/cheques', label: 'Cheques', icon: Banknote, category: 'cheques' },
  { to: '/journal', label: 'Journal Entry', icon: SquarePen, category: 'neutral', adminOnly: true },
  { to: '/salary', label: 'Salary', icon: Users2, category: 'salary', adminOnly: true },
]

const BOOKS: NavItemDef[] = [
  { to: '/accounts', label: 'Accounts', icon: Wallet, category: 'neutral' },
  { to: '/customers', label: 'Customers', icon: UserRound, category: 'customers' },
  { to: '/transactions', label: 'Transactions', icon: List, category: 'neutral' },
  { to: '/stock', label: 'Ledgers', icon: Coins, category: 'fx' },
  { to: '/balance-sheet', label: 'Balance Sheet', icon: Landmark, category: 'reports', adminOnly: true },
  { to: '/income-statement', label: 'Income Statement', icon: TrendingUp, category: 'reports', adminOnly: true },
]

function NavGroup({ title, items, isAdmin }: { title: string; items: NavItemDef[]; isAdmin: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-2 pb-1 text-meta font-bold uppercase tracking-wider text-sidebar-text-faint">{title}</div>
      {items.map((item) => {
        const cat = SIDEBAR_CATEGORY_COLORS[item.category]
        const locked = !isAdmin && item.adminOnly
        const link = (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-body no-underline whitespace-nowrap transition-[background-color,box-shadow,color] duration-150 ease-out',
                isActive ? 'bg-sidebar-active-bg font-semibold text-sidebar-active-text shadow-xs' : 'font-normal text-sidebar-text hover:bg-sidebar-hover-bg',
                locked && 'opacity-60',
              )
            }
          >
            <span className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-[5px]" style={{ background: cat.bg, color: cat.color }}>
              <item.icon size={13} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {locked && <Lock size={10} className="ml-auto flex-none text-sidebar-text-faint" aria-hidden="true" />}
          </NavLink>
        )
        if (!locked) return link
        return (
          <Tooltip key={item.to}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label} is Admin-only.</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

export function Sidebar() {
  const { isAdmin } = useStore()
  return (
    <aside className="sticky top-0 flex h-screen w-[214px] flex-none flex-col border-r border-sidebar-border bg-sidebar-bg print:hidden">
      <div className="flex h-[52px] flex-none items-center gap-2.5 border-b border-sidebar-border px-3.5">
        <Logo />
        <div className="whitespace-nowrap text-body font-semibold tracking-tight text-sidebar-text">Currency Desk</div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto p-2 pt-3.5 pb-[18px]">
        <NavGroup title="Overview" items={OVERVIEW} isAdmin={isAdmin} />
        <NavGroup title="Transactions" items={TRANSACTIONS} isAdmin={isAdmin} />
        <NavGroup title="Books" items={BOOKS} isAdmin={isAdmin} />
      </nav>

      <div className="flex-none border-t border-sidebar-border px-3.5 py-2.5 text-meta text-sidebar-text-faint">Signed in as {isAdmin ? 'Admin' : 'Operator'}</div>
    </aside>
  )
}
