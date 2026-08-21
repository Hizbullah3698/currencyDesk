import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Lock, ArrowDownCircle, ArrowUpCircle, Coins, TrendingUp } from 'lucide-react'
import { useStore } from '@/lib/store'
import { isToday, stk } from '@/lib/engine'
import { fmt, fmtNum, fmtRate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { CATEGORY_COLORS } from '@/lib/ui-helpers'
import { ThemeToggle } from './ThemeToggle'

function StripItem({
  category,
  icon: Icon,
  label,
  value,
  valueClassName,
  sub,
  bordered = true,
}: {
  category: keyof typeof CATEGORY_COLORS
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>
  label: string
  value: string
  valueClassName?: string
  sub?: string
  bordered?: boolean
}) {
  const cat = CATEGORY_COLORS[category]
  return (
    <div className={cn('flex flex-none items-center gap-2.5 whitespace-nowrap py-2 pl-[18px] pr-[18px]', bordered && 'border-r border-strip-border')}>
      <div className="flex items-center gap-1.5">
        <span className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px]" style={{ background: cat.bg, color: cat.color }}>
          <Icon size={11} strokeWidth={2.2} aria-hidden="true" />
        </span>
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-70">{label}</span>
      </div>
      <span className={cn('tabular text-[13px] font-semibold', valueClassName)}>{value}</span>
      {sub && <span className="text-[11px] text-muted-60">{sub}</span>}
    </div>
  )
}

export function TopBar() {
  const { state, isAdmin, login, logout } = useStore()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const totals = useMemo(() => {
    const customers = state.accounts.filter((a) => a.type === 'Customer')
    return {
      receivable: customers.reduce((s, c) => s + (c.receivable || 0), 0),
      receivableCount: customers.filter((c) => (c.receivable || 0) > 0).length,
      payable: customers.reduce((s, c) => s + (c.payable || 0), 0),
      payableCount: customers.filter((c) => (c.payable || 0) > 0).length,
      marginToday: state.activity.filter((t) => t.type === 'sale' && isToday(t.createdAt)).reduce((s, t) => s + (t.margin || 0), 0),
    }
  }, [state.accounts, state.activity])
  const aed = stk(state.stocks, 'AED')

  function onSearchEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !search.trim()) return
    navigate('/customers')
  }

  return (
    <div className="sticky top-0 z-20 print:hidden">
      <div className="flex h-[52px] items-center gap-3.5 border-b border-border-strong bg-surface px-[22px]">
        <div className="flex h-8 max-w-[340px] flex-1 items-center gap-1.5 rounded-[6px] border border-border-strong bg-surface-sunken px-2.5 transition-colors duration-150 focus-within:border-accent-border">
          <Search size={14} className="flex-none text-muted-60" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchEnter}
            placeholder="Search customers"
            aria-label="Search customers"
            className="h-auto min-w-0 flex-1 border-none bg-transparent p-0 text-[12.5px] text-ink shadow-none focus-visible:outline-none"
          />
        </div>
        <div className="ml-auto flex flex-none items-center gap-2">
          <ThemeToggle />
          <span className="whitespace-nowrap text-[10.5px] font-medium uppercase tracking-wide text-muted-70">Viewing as</span>
          <div className="flex overflow-hidden rounded-[6px] border border-border-strong">
            <button
              onClick={() => login('admin', state.userName)}
              aria-pressed={isAdmin}
              className={cn(
                'px-3 py-1.5 text-[11.5px] font-semibold transition-[background-color,box-shadow] duration-150 ease-out',
                isAdmin ? 'bg-accent-solid text-white shadow-xs' : 'bg-surface text-ink hover:bg-surface-tint',
              )}
            >
              Admin
            </button>
            <button
              onClick={() => login('user', 'Operations user')}
              aria-pressed={!isAdmin}
              className={cn(
                'border-l border-border-strong px-3 py-1.5 text-[11.5px] font-semibold transition-[background-color,box-shadow] duration-150 ease-out',
                !isAdmin ? 'bg-accent-solid text-white shadow-xs' : 'bg-surface text-ink hover:bg-surface-tint',
              )}
            >
              User
            </button>
          </div>
          <button onClick={logout} className="whitespace-nowrap px-2 py-1.5 text-[11.5px] font-medium text-muted-70 transition-colors duration-150 hover:text-ink">
            Sign out
          </button>
        </div>
      </div>

      <div className="flex min-h-[44px] items-stretch gap-0 overflow-x-auto border-b border-border-strong bg-strip-bg px-[22px]">
        <StripItem category="customers" icon={ArrowDownCircle} label="Owed to you" value={fmt(totals.receivable)} valueClassName="text-positive-text" sub={`${totals.receivableCount} customers`} />
        <StripItem category="customers" icon={ArrowUpCircle} label="You owe" value={fmt(totals.payable)} valueClassName="text-negative-text" sub={`${totals.payableCount} customers`} />
        <StripItem category="fx" icon={Coins} label="AED stock" value={fmtNum(aed.available)} sub={`@ ${fmtRate(aed.avgCost)}`} />
        <div className="ml-auto flex flex-none items-center gap-2.5 whitespace-nowrap py-2 pl-[18px]">
          <div className="flex items-center gap-1.5">
            <span className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px]" style={{ background: CATEGORY_COLORS.reports.bg, color: CATEGORY_COLORS.reports.color }}>
              <TrendingUp size={11} strokeWidth={2.2} aria-hidden="true" />
            </span>
            <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-70">Margin today</span>
          </div>
          <span className="tabular text-[13px] font-semibold text-positive-text">{fmt(totals.marginToday)}</span>
        </div>
      </div>

      {!isAdmin && (
        <div className="flex items-center gap-2 border-b border-pending-border bg-pending-bg px-[22px] py-1.5 text-[11.5px] leading-normal text-pending-text">
          <Lock size={11} className="flex-none" strokeWidth={2.4} aria-hidden="true" />
          <strong className="font-bold">Operations user</strong>
          <span>Journal Entry, Salary, Balance Sheet, Income Statement and the currency ledger are Admin-only, as is creating or editing any account. Cheques can be marked deposited, but clearing and returning need Admin.</span>
        </div>
      )}
    </div>
  )
}
