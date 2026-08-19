import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Lock } from 'lucide-react'
import { useStore } from '@/lib/store'
import { isToday, stk } from '@/lib/engine'
import { fmt, fmtNum, fmtRate } from '@/lib/format'
import { cn } from '@/lib/utils'

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
    <div className="sticky top-0 z-20">
      <div className="flex h-[52px] items-center gap-3.5 border-b border-border-strong bg-surface px-[22px]">
        <div className="flex h-8 max-w-[340px] flex-1 items-center gap-1.5 rounded-[6px] border border-border-strong bg-surface-sunken px-2.5">
          <Search size={14} className="flex-none text-muted-60" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchEnter}
            placeholder="Search customers"
            className="min-w-0 flex-1 border-none bg-transparent text-[12.5px] text-ink outline-none"
          />
        </div>
        <div className="ml-auto flex flex-none items-center gap-2">
          <span className="whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-wide text-muted-70">Viewing as</span>
          <div className="flex overflow-hidden rounded-[6px] border border-border-strong">
            <button
              onClick={() => login('admin', state.userName)}
              className={cn('px-3 py-1.5 text-[11.5px] font-semibold transition-colors', isAdmin ? 'bg-accent text-white' : 'bg-surface text-ink hover:bg-surface-tint')}
            >
              Admin
            </button>
            <button
              onClick={() => login('user', 'Operations user')}
              className={cn('border-l border-border-strong px-3 py-1.5 text-[11.5px] font-semibold transition-colors', !isAdmin ? 'bg-accent text-white' : 'bg-surface text-ink hover:bg-surface-tint')}
            >
              User
            </button>
          </div>
          <button onClick={logout} className="whitespace-nowrap px-2 py-1.5 text-[11.5px] font-medium text-muted-70 transition-colors hover:text-ink">
            Sign out
          </button>
        </div>
      </div>

      <div className="flex min-h-[44px] items-stretch gap-0 overflow-x-auto border-b border-border-strong bg-[#eceff3] px-[22px]">
        <div className="flex flex-none items-center gap-2 whitespace-nowrap border-r border-[#d3d8df] py-2 pr-[22px]">
          <div className="h-1.5 w-1.5 flex-none rounded-full bg-positive" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-70">Owed to you</span>
          <span className="tabular text-[13px] font-semibold text-positive-text">{fmt(totals.receivable)}</span>
          <span className="text-[11px] text-muted-70">{totals.receivableCount} customers</span>
        </div>
        <div className="flex flex-none items-center gap-2 whitespace-nowrap border-r border-[#d3d8df] py-2 pl-[22px] pr-[22px]">
          <div className="h-1.5 w-1.5 flex-none rounded-full bg-negative" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-70">You owe</span>
          <span className="tabular text-[13px] font-semibold text-negative-text">{fmt(totals.payable)}</span>
          <span className="text-[11px] text-muted-70">{totals.payableCount} customers</span>
        </div>
        <div className="flex flex-none items-center gap-2 whitespace-nowrap py-2 pl-[22px]">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-70">AED stock</span>
          <span className="tabular text-[13px] font-semibold">{fmtNum(aed.available)}</span>
          <span className="text-[11px] text-muted-70">@ {fmtRate(aed.avgCost)}</span>
        </div>
        <div className="ml-auto flex flex-none items-center gap-2 whitespace-nowrap py-2 pl-[22px]">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-70">Margin today</span>
          <span className="tabular text-[13px] font-semibold text-positive-text">{fmt(totals.marginToday)}</span>
        </div>
      </div>

      {!isAdmin && (
        <div className="flex items-center gap-2 border-b border-pending-border bg-pending-bg px-[22px] py-1.5 text-[11.5px] leading-normal text-pending-text">
          <Lock size={11} className="flex-none" strokeWidth={2.4} />
          <strong className="font-bold">Operations user</strong>
          <span>Journal Entry, Salary, Balance Sheet, Income Statement and the currency ledger are Admin-only, as is creating or editing any account. Cheques can be marked deposited, but clearing and returning need Admin.</span>
        </div>
      )}
    </div>
  )
}
