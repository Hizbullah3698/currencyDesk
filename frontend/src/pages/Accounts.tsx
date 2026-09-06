import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { fmt } from '@/lib/format'
import { ACCOUNT_TYPES } from '@/lib/types'
import type { Account, AccountType } from '@/lib/types'
import { Lock, SearchX, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AccountFormModal } from '@/components/AccountFormModal'
import { cn } from '@/lib/utils'

export function Accounts() {
  const { state, isAdmin, inUseAccountIds } = useStore()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'All' | AccountType>('All')
  const [params] = useSearchParams()

  const [open, setOpen] = useState(!!params.get('new'))
  const [mode, setMode] = useState<'new' | 'edit'>('new')
  const [editId, setEditId] = useState('')
  const [defaultType, setDefaultType] = useState<AccountType>((params.get('new') as AccountType) || 'Customer')

  // The client asked to see the accounts they created, not the scaffold the chart of accounts
  // ships with. The 13 built-in accounts (`system`, from is_system) stay hidden until something
  // is actually posted against them, at which point they appear on their own.
  //
  // THIS FILTER IS FOR THIS LIST AND NOTHING ELSE. It must never move into `state.accounts` or
  // into the API snapshot: Journal.tsx builds its debit/credit picker from the full array (that
  // is what keeps Bank, Cash and Capital postable while hidden here), Salary.tsx picks the
  // pay-from account out of it, and BalanceSheet.tsx hands the whole array to computeBalanceSheet
  // — which iterates Currency Stock ACCOUNTS to value each holding, so filtering upstream would
  // take the desk's currency off its own balance sheet.
  const visible = useMemo(() => state.accounts.filter((a) => !a.system || inUseAccountIds.has(a.id)), [state.accounts, inUseAccountIds])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return visible
      .filter((a) => (typeFilter === 'All' ? true : a.type === typeFilter))
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .sort((a, b) => ACCOUNT_TYPES.indexOf(a.type) - ACCOUNT_TYPES.indexOf(b.type) || a.name.localeCompare(b.name))
  }, [visible, search, typeFilter])

  function balanceOf(a: Account) {
    if (a.type === 'Customer') return { dr: a.receivable || 0, cr: a.payable || 0 }
    return { dr: 0, cr: 0 }
  }

  function openNew(type: AccountType) {
    setMode('new')
    setEditId('')
    setDefaultType(type)
    setOpen(true)
  }
  function openEdit(a: Account) {
    if (!isAdmin) return
    setMode('edit')
    setEditId(a.id)
    setOpen(true)
  }
  function close() {
    setOpen(false)
  }

  return (
    <div>
      <div className="mb-[26px] flex items-start justify-between gap-4">
        <div>
          <h1 className="m-0 mb-1 text-heading font-semibold tracking-tight">Accounts</h1>
          <div className="text-body font-normal text-muted-70">
            {visible.length === 0 ? 'Nothing here yet — add your first account.' : `${visible.length} accounts — customers, banks, expenses and equity in one book.`}
          </div>
        </div>
        {isAdmin ? (
          <Button variant="primary" className="flex-none px-3.5 py-2" onClick={() => openNew('Customer')}>
            New account
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="primary" aria-disabled="true" className="flex-none cursor-not-allowed px-3.5 py-2 opacity-50 hover:bg-accent-solid hover:shadow-xs">
                <Lock size={12} strokeWidth={2.4} aria-hidden="true" />
                New account
              </Button>
            </TooltipTrigger>
            <TooltipContent>Account management is Admin-only.</TooltipContent>
          </Tooltip>
        )}
      </div>

      {visible.length > 0 && (
      <div className="mb-5 flex items-center gap-2.5">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accounts" className="w-[250px] flex-none" />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
          {(['All', ...ACCOUNT_TYPES] as const).map((t) => {
            const count = t === 'All' ? visible.length : visible.filter((a) => a.type === t).length
            const active = typeFilter === t
            return (
              <Button
                key={t}
                type="button"
                variant="secondary"
                size="sm"
                aria-pressed={active}
                onClick={() => setTypeFilter(t)}
                className={cn('flex-none gap-1 text-meta', active && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
              >
                {t}
                <span className="tabular text-meta opacity-70">{count}</span>
              </Button>
            )
          })}
        </div>
      </div>
      )}

      {rows.length > 0 && (
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-0 flex-1">Account</div>
          <div className="min-w-[112px]">Type</div>
          <div className="min-w-0 flex-[1.1]">Detail</div>
          <div className="min-w-[150px] text-right">Balance</div>
          <div className="w-3.5" />
        </div>
        {rows.map((a) => {
          const bal = balanceOf(a)
          return (
            <div key={a.id} onClick={() => openEdit(a)} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2.5 transition-colors duration-150 hover:bg-surface-hover">
              <div className="min-w-0 flex-1 text-body font-semibold">{a.name}</div>
              <div className="min-w-[112px] text-meta font-normal text-muted-70">{a.type}</div>
              <div className="min-w-0 flex-[1.1] truncate text-meta font-normal text-muted-70">{detailFor(a)}</div>
              <div className="flex min-w-[150px] items-baseline justify-end gap-1.5 text-right">
                {bal.dr > 0 && <span className="tabular text-body font-medium text-positive">{fmt(bal.dr)}</span>}
                {bal.cr > 0 && <span className="tabular text-body font-medium text-negative">{fmt(bal.cr)}</span>}
                {!bal.dr && !bal.cr && <span className="tabular text-body font-normal text-muted-60">—</span>}
              </div>
              <div className="w-3.5 text-muted-42" aria-hidden="true">→</div>
            </div>
          )
        })}
      </Card>
      )}

      {rows.length === 0 &&
        (visible.length === 0 ? (
          <EmptyState
            category="neutral"
            icon={Wallet}
            title="No accounts yet."
            // Names Bank, Cash and the currency positions specifically. They exist and are
            // working right now — they are simply not shown until something is posted against
            // them — and without saying so an empty list reads as though the chart of accounts
            // were missing rather than merely unused.
            description="Bank, Cash and your currency positions appear here once the first transaction is recorded. Add a customer, bank or expense account of your own to get started."
            action={
              isAdmin ? (
                <Button variant="primary" className="px-3.5 py-2" onClick={() => openNew('Customer')}>
                  New account
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState category="neutral" icon={SearchX} title="No accounts match this filter." />
        ))}

      {open && <AccountFormModal mode={mode} editId={editId} defaultType={defaultType} onClose={close} />}
    </div>
  )
}

function detailFor(a: Account): string {
  if (a.type === 'Bank') return [a.bankName, a.accountNo].filter(Boolean).join(' · ')
  if (a.type === 'Employee') return [a.designation, a.monthlySalary ? `PKR ${a.monthlySalary.toLocaleString('en-US')}/mo` : ''].filter(Boolean).join(' · ')
  if (a.type === 'Currency Stock') return `Currency ${a.code}`
  if (a.type === 'Expense') return a.category || 'General'
  if (a.type === 'Customer') return [a.phone, a.city].filter((x) => x && x !== '—').join(' · ') || '—'
  return a.notes || '—'
}
