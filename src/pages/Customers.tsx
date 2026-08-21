import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { useStore } from '@/lib/store'
import { relLabel } from '@/lib/engine'
import { fmt } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

export function Customers() {
  const { state, isAdmin } = useStore()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const customers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return state.accounts
      .filter((a) => a.type === 'Customer')
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .map((c) => {
        const last = state.activity.filter((t) => t.customerId === c.id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]
        return { ...c, lastActivity: last ? relLabel(last.createdAt) : '—' }
      })
  }, [state.accounts, state.activity, search])

  return (
    <div>
      <div className="mb-3.5 flex items-center justify-between gap-2.5">
        <h1 className="m-0 text-[17px] font-semibold">Customers</h1>
        <div className="flex items-center gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers…" className="min-w-[220px]" />
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
            <div className="flex-1 text-[13px] font-semibold">{c.name}</div>
            <div className={`tabular min-w-[130px] text-right text-[12.5px] font-medium ${(c.receivable || 0) > 0 ? 'text-positive' : 'text-muted-60'}`}>{fmt(c.receivable || 0)}</div>
            <div className={`tabular min-w-[130px] text-right text-[12.5px] font-medium ${(c.payable || 0) > 0 ? 'text-negative' : 'text-muted-60'}`}>{fmt(c.payable || 0)}</div>
            <div className="min-w-[80px] text-right text-[11px] font-normal text-muted-60">{c.lastActivity}</div>
            <div className="w-3.5 text-muted-42" aria-hidden="true">→</div>
          </div>
        ))}
      </Card>
      {customers.length === 0 && <EmptyState icon={SearchX} title={`No customers match "${search}".`} />}
    </div>
  )
}
