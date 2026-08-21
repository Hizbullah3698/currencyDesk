import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { fmt } from '@/lib/format'
import { ACCOUNT_TYPES } from '@/lib/types'
import type { Account, AccountType } from '@/lib/types'
import { Lock, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { AccountFormModal } from '@/components/AccountFormModal'
import { cn } from '@/lib/utils'

export function Accounts() {
  const { state, isAdmin, accountHasActivity } = useStore()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'All' | AccountType>('All')
  const [params] = useSearchParams()

  const [open, setOpen] = useState(!!params.get('new'))
  const [mode, setMode] = useState<'new' | 'edit'>('new')
  const [editId, setEditId] = useState('')
  const [defaultType, setDefaultType] = useState<AccountType>((params.get('new') as AccountType) || 'Customer')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return state.accounts
      .filter((a) => (typeFilter === 'All' ? true : a.type === typeFilter))
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .sort((a, b) => ACCOUNT_TYPES.indexOf(a.type) - ACCOUNT_TYPES.indexOf(b.type) || a.name.localeCompare(b.name))
  }, [state.accounts, search, typeFilter])

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
      <div className="mb-[18px] flex items-start justify-between gap-4">
        <div>
          <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-tight">Accounts</h1>
          <div className="text-[12px] font-normal text-muted-70">{state.accounts.length} accounts — customers, banks, expenses and equity in one book.</div>
        </div>
        {isAdmin ? (
          <Button variant="primary" className="flex-none px-3.5 py-2" onClick={() => openNew('Customer')}>
            New account
          </Button>
        ) : (
          <div className="flex flex-none items-center gap-1.5 rounded-[6px] border border-locked-border bg-locked-bg px-2.5 py-1.5 text-[11.5px] font-semibold text-locked-text">
            <Lock size={12} strokeWidth={2.4} aria-hidden="true" />
            Read-only — account management is Admin-only
          </div>
        )}
      </div>

      <div className="mb-3.5 flex items-center gap-2.5">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accounts" className="w-[250px] flex-none" />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
          {(['All', ...ACCOUNT_TYPES] as const).map((t) => {
            const count = t === 'All' ? state.accounts.length : state.accounts.filter((a) => a.type === t).length
            const active = typeFilter === t
            return (
              <Button
                key={t}
                type="button"
                variant="secondary"
                size="sm"
                aria-pressed={active}
                onClick={() => setTypeFilter(t)}
                className={cn('flex-none gap-1 text-[11.5px]', active && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
              >
                {t}
                <span className="tabular text-[10.5px] opacity-70">{count}</span>
              </Button>
            )
          })}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-0 flex-1">Account</div>
          <div className="min-w-[112px]">Type</div>
          <div className="min-w-0 flex-[1.1]">Detail</div>
          <div className="min-w-[150px] text-right">Balance</div>
          <div className="min-w-[62px] text-right">Status</div>
          <div className="w-3.5" />
        </div>
        {rows.map((a) => {
          const bal = balanceOf(a)
          const inUse = accountHasActivity(a.id)
          return (
            <div key={a.id} onClick={() => openEdit(a)} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2.5 transition-colors duration-150 hover:bg-surface-hover">
              <div className="min-w-0 flex-1 text-[12.5px] font-semibold">{a.name}</div>
              <div className="min-w-[112px] text-[11.5px] font-normal text-muted-70">{a.type}</div>
              <div className="min-w-0 flex-[1.1] truncate text-[11.5px] font-normal text-muted-70">{detailFor(a)}</div>
              <div className="flex min-w-[150px] items-baseline justify-end gap-1.5 text-right">
                {bal.dr > 0 && <span className="tabular text-[12.5px] font-medium text-positive">{fmt(bal.dr)}</span>}
                {bal.cr > 0 && <span className="tabular text-[12.5px] font-medium text-negative">{fmt(bal.cr)}</span>}
                {!bal.dr && !bal.cr && <span className="tabular text-[12.5px] font-normal text-muted-60">—</span>}
              </div>
              <div className="min-w-[62px] text-right">
                <Badge variant={inUse ? 'accent' : 'neutral'}>{inUse ? 'In use' : 'Unused'}</Badge>
              </div>
              <div className="w-3.5 text-muted-42" aria-hidden="true">→</div>
            </div>
          )
        })}
      </Card>
      {rows.length === 0 && <EmptyState icon={SearchX} title="No accounts match this filter." />}

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
