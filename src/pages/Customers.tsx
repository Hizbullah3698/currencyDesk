import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { useStore } from '@/lib/store'
import { relLabel } from '@/lib/engine'
import { fmt } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

export function Customers() {
  const { state, isAdmin } = useStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const owe = searchParams.get('owe') === 'payable' ? 'payable' : searchParams.get('owe') === 'receivable' ? 'receivable' : null
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const archivedCount = useMemo(() => state.accounts.filter((a) => a.type === 'Customer' && a.archived).length, [state.accounts])

  const customers = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = state.accounts
      .filter((a) => a.type === 'Customer')
      .filter((a) => showArchived || !a.archived)
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .map((c) => {
        const last = state.activity.filter((t) => t.customerId === c.id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]
        return { ...c, lastActivity: last ? relLabel(last.createdAt) : '—' }
      })
    if (owe === 'receivable') list = list.filter((c) => (c.receivable || 0) > 0).sort((a, b) => (b.receivable || 0) - (a.receivable || 0))
    if (owe === 'payable') list = list.filter((c) => (c.payable || 0) > 0).sort((a, b) => (b.payable || 0) - (a.payable || 0))
    return list
  }, [state.accounts, state.activity, search, showArchived, owe])

  return (
    <div>
      {owe && (
        <div className="mb-3 flex items-center justify-between gap-2.5 rounded-[6px] border border-border-strong bg-surface-tint px-3 py-2 text-[12.5px]">
          <span>
            {owe === 'payable'
              ? `Showing customers you owe money to, largest balance first — open one and use "Make Payment" to pay it.`
              : `Showing customers who owe you money, largest balance first — open one and use "Receive Payment" to collect it.`}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setSearchParams({})}>
            Show all customers
          </Button>
        </div>
      )}
      <div className="mb-3.5 flex items-center justify-between gap-2.5">
        <h1 className="m-0 text-[17px] font-semibold">Customers</h1>
        <div className="flex items-center gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers…" className="min-w-[220px]" />
          {archivedCount > 0 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((v) => !v)}
              className={cn('gap-1 text-[11.5px]', showArchived && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
            >
              Show archived
              <span className="tabular text-[10.5px] opacity-70">{archivedCount}</span>
            </Button>
          )}
          {isAdmin && (
            <Button variant="primary" onClick={() => navigate('/accounts?new=Customer')}>
              + Add Customer
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="flex-1">Customer</div>
          <div className="min-w-[130px] text-right">Owed to you</div>
          <div className="min-w-[130px] text-right">You owe</div>
          <div className="min-w-[80px] text-right">Last activity</div>
          <div className="w-3.5" />
        </div>
        {customers.map((c) => (
          <div key={c.id} onClick={() => navigate(`/customers/${c.id}`)} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2.5 transition-colors duration-150 hover:bg-surface-hover">
            <div className="flex flex-1 items-center gap-1.5">
              <span className="text-[13px] font-semibold">{c.name}</span>
              {c.archived && <Badge variant="neutral">Archived</Badge>}
            </div>
            <div className={`tabular min-w-[130px] text-right text-[12.5px] font-medium ${(c.receivable || 0) > 0 ? 'text-positive' : 'text-muted-60'}`}>{fmt(c.receivable || 0)}</div>
            <div className={`tabular min-w-[130px] text-right text-[12.5px] font-medium ${(c.payable || 0) > 0 ? 'text-negative' : 'text-muted-60'}`}>{fmt(c.payable || 0)}</div>
            <div className="min-w-[80px] text-right text-[11px] font-normal text-muted-60">{c.lastActivity}</div>
            <div className="w-3.5 text-muted-42" aria-hidden="true">→</div>
          </div>
        ))}
      </Card>
      {customers.length === 0 && (
        <EmptyState
          icon={SearchX}
          title={
            owe === 'payable'
              ? 'No customers currently owed money.'
              : owe === 'receivable'
                ? 'No customers currently owe you money.'
                : `No customers match "${search}".`
          }
        />
      )}
    </div>
  )
}
