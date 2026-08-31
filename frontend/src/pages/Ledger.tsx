import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Inbox, ChevronRight } from 'lucide-react'
import { useStore } from '@/lib/store'
import { customSearchFilter } from '@/lib/customerSearch'
import { fmt } from '@/lib/format'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * Ledger landing screen: pick a customer, nothing more.
 *
 * Deliberately shows no transaction rows. A statement is scoped to one customer, and putting
 * transactions on the chooser would both leak one customer's dealings onto a screen someone opened
 * to look up another, and bury the one thing this page is for.
 *
 * Distinct from the Customers page, which is for *managing* customers — editing details, archiving,
 * starting a trade. This is the reporting entrance. They share the matching rule
 * (lib/customerSearch.ts) rather than the markup, because a compact picker and a browsable list
 * genuinely want different shapes.
 */
export function Ledger() {
  const { state } = useStore()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const customers = useMemo(
    () =>
      state.accounts
        .filter((a) => a.type === 'Customer' && !a.archived)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [state.accounts],
  )

  const filtered = useMemo(() => customSearchFilter(customers, search), [customers, search])

  return (
    <div className="max-w-[760px]">
      <h1 className="m-0 mb-[26px] text-heading font-semibold">Customer Ledger</h1>

      <div className="mb-3 flex h-9 items-center gap-1.5 rounded-control border border-border-strong bg-surface px-2.5 transition-colors duration-150 focus-within:border-accent-border">
        <Search size={15} className="flex-none text-muted-60" aria-hidden="true" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customers by name"
          aria-label="Search customers by name"
          autoFocus
          className="h-auto min-w-0 flex-1 border-none bg-transparent p-0 text-body text-ink shadow-none focus-visible:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          category="customers"
          icon={Inbox}
          title={search ? `No customer matches "${search}".` : 'No customers yet.'}
          className="py-10"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
            <div className="flex-1">Customer</div>
            <div className="min-w-[120px] text-right">Owes the desk</div>
            <div className="min-w-[120px] text-right">Desk owes</div>
            <div className="w-5" aria-hidden="true" />
          </div>
          {filtered.map((c) => {
            const receivable = c.receivable || 0
            const payable = c.payable || 0
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/ledger/${c.id}`)}
                className="flex w-full items-center gap-2.5 border-b border-divider px-[13px] py-2.5 text-left transition-colors duration-150 hover:bg-surface-hover"
              >
                <div className="flex-1">
                  <div className="text-body font-medium text-ink">{c.name}</div>
                  {(c.city || c.phone) && (
                    <div className="text-meta font-normal text-muted-60">{[c.city, c.phone].filter((x) => x && x !== '—').join(' · ')}</div>
                  )}
                </div>
                {/* A balance summary only — enough to recognise the right customer, not a statement. */}
                <div className={`tabular min-w-[120px] text-right text-body ${receivable > 0 ? 'font-medium text-ink' : 'font-normal text-muted-42'}`}>
                  {receivable > 0 ? fmt(receivable) : '—'}
                </div>
                <div className={`tabular min-w-[120px] text-right text-body ${payable > 0 ? 'font-medium text-ink' : 'font-normal text-muted-42'}`}>
                  {payable > 0 ? fmt(payable) : '—'}
                </div>
                <ChevronRight size={15} className="flex-none text-muted-42" aria-hidden="true" />
              </button>
            )
          })}
          <div className="px-[13px] py-2 text-meta font-normal text-muted-60">
            {filtered.length} of {customers.length} customer{customers.length === 1 ? '' : 's'}
          </div>
        </Card>
      )}
    </div>
  )
}
