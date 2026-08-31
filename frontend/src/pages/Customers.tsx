import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, SearchX, Users } from 'lucide-react'
import { useStore } from '@/lib/store'
import { relLabel } from '@/lib/engine'
import { fmt } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

const PICKS = 8

interface CustomerRow {
  id: string
  name: string
  archived?: boolean
  receivable?: number
  payable?: number
  lastActivity: string
}

export function Customers() {
  const { state, isAdmin } = useStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const owe = searchParams.get('owe') === 'payable' ? 'payable' : searchParams.get('owe') === 'receivable' ? 'receivable' : null
  // The search term lives in the URL (?q=), not local state, so the TopBar's own search box can
  // hand a query straight to this page while it is already mounted — a plain useState would
  // ignore that, since the component never remounts on a same-route navigation. `replace: true`
  // keeps per-keystroke typing out of the browser history.
  const search = searchParams.get('q') || ''
  const setSearch = (v: string) => setSearchParams(v ? { q: v } : {}, { replace: true })
  const [showArchived, setShowArchived] = useState(false)
  const [browseAll, setBrowseAll] = useState(false)

  const archivedCount = useMemo(() => state.accounts.filter((a) => a.type === 'Customer' && a.archived).length, [state.accounts])

  // Everything visible under the current archived setting, before any name search. This is what
  // "Browse all N customers" counts, and what the drill-downs filter down from.
  const visible: CustomerRow[] = useMemo(
    () =>
      state.accounts
        .filter((a) => a.type === 'Customer')
        .filter((a) => showArchived || !a.archived)
        .map((c) => {
          const last = state.activity.filter((t) => t.customerId === c.id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]
          return { id: c.id, name: c.name, archived: c.archived, receivable: c.receivable, payable: c.payable, lastActivity: last ? relLabel(last.createdAt) : '—' }
        }),
    [state.accounts, state.activity, showArchived],
  )

  const q = search.trim().toLowerCase()
  const matches = useMemo(() => (q ? visible.filter((c) => c.name.toLowerCase().includes(q)) : []), [visible, q])

  // The TopBar's ?owe= drill-downs are a deliberate LIST view — "show me everyone who owes me,
  // biggest first" — not a search. They must land straight on the filtered table, with the
  // banner, exactly as before; the search-first flow below only governs the plain /customers URL.
  const oweList = useMemo(() => {
    if (!owe) return []
    const key = owe === 'receivable' ? 'receivable' : 'payable'
    return visible.filter((c) => (c[key] || 0) > 0).sort((a, b) => (b[key] || 0) - (a[key] || 0))
  }, [visible, owe])

  const listMode = !!owe || browseAll
  const tableRows = owe ? oweList : visible

  function openFirstMatch(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !matches.length) return
    navigate(`/customers/${matches[0].id}`)
  }

  const archivedToggle = archivedCount > 0 && (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-pressed={showArchived}
      onClick={() => setShowArchived((v) => !v)}
      className={cn('gap-1 text-meta', showArchived && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
    >
      Show archived
      <span className="tabular text-meta opacity-70">{archivedCount}</span>
    </Button>
  )

  const addButton = isAdmin && (
    <Button variant="primary" onClick={() => navigate('/accounts?new=Customer')}>
      + Add Customer
    </Button>
  )

  // -------------------------------------------------------------------------
  // List view — the ?owe= drill-downs, and the explicit "browse all" escape hatch.
  // -------------------------------------------------------------------------
  if (listMode) {
    return (
      <div>
        {owe && (
          <div className="mb-3 flex items-center justify-between gap-2.5 rounded-control border border-border-strong bg-surface-tint px-3 py-2 text-body">
            <span>
              {owe === 'payable'
                ? `Showing customers you owe money to, largest balance first — open one and use "Make Payment" to pay it.`
                : `Showing customers who owe you money, largest balance first — open one and use "Receive Payment" to collect it.`}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setSearchParams({})}>
              Back to search
            </Button>
          </div>
        )}
        <div className="mb-[26px] flex items-center justify-between gap-2.5">
          <div>
            <h1 className="m-0 text-heading font-semibold">Customers</h1>
            {!owe && <div className="mt-0.5 text-meta font-normal text-muted-60">All {visible.length} customer{visible.length === 1 ? '' : 's'} on file.</div>}
          </div>
          <div className="flex items-center gap-2">
            {!owe && (
              <Button variant="secondary" size="sm" onClick={() => setBrowseAll(false)}>
                <Search size={13} strokeWidth={2} aria-hidden="true" />
                Back to search
              </Button>
            )}
            {archivedToggle}
            {addButton}
          </div>
        </div>

        <CustomerTable rows={tableRows} onOpen={(id) => navigate(`/customers/${id}`)} />
        {tableRows.length === 0 && (
          <EmptyState
            category="customers"
            icon={SearchX}
            title={owe === 'payable' ? 'No customers currently owed money.' : owe === 'receivable' ? 'No customers currently owe you money.' : 'No customers on file yet.'}
          />
        )}
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Search-first view — the default. Nothing is listed until a name is typed, so
  // choosing "Khan" opens Khan rather than surfacing every customer on the desk.
  // -------------------------------------------------------------------------
  return (
    <div className="max-w-[720px]">
      <div className="mb-[26px] flex items-start justify-between gap-2.5">
        <div>
          <h1 className="m-0 text-heading font-semibold">Customers</h1>
          <div className="mt-0.5 text-body font-normal text-muted-60">Search for the customer you want and open their account.</div>
        </div>
        <div className="flex items-center gap-2">
          {archivedToggle}
          {addButton}
        </div>
      </div>

      <Card className="p-4">
        <label htmlFor="customer-search" className="mb-1.5 block text-meta font-semibold text-muted-70">
          Customer name
        </label>
        <div className="flex h-11 items-center gap-2 rounded-control border border-border-input bg-surface px-3 transition-colors duration-150 focus-within:border-accent-border">
          <Search size={16} className="flex-none text-muted-60" aria-hidden="true" />
          <Input
            id="customer-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={openFirstMatch}
            placeholder="Start typing a name…"
            autoFocus
            className="h-auto min-w-0 flex-1 border-none bg-transparent p-0 text-body text-ink shadow-none focus-visible:outline-none"
          />
        </div>

        {q ? (
          matches.length > 0 ? (
            <>
              <div className="mt-3 text-meta font-medium uppercase tracking-wide text-muted-60">
                {matches.length} match{matches.length === 1 ? '' : 'es'} — pick one to open it
              </div>
              <div className="mt-1.5 overflow-hidden rounded-control border border-border">
                {matches.slice(0, PICKS).map((c, i) => (
                  <div
                    key={c.id}
                    onClick={() => navigate(`/customers/${c.id}`)}
                    className={cn('flex cursor-pointer items-center gap-2.5 px-3 py-2.5 transition-colors duration-150 hover:bg-surface-hover', i > 0 && 'border-t border-divider')}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="truncate text-body font-semibold">{c.name}</span>
                      {c.archived && <Badge variant="neutral">Archived</Badge>}
                    </div>
                    <div className="tabular text-meta font-normal text-muted-60">
                      {(c.receivable || 0) > 0 && <span className="text-positive-text">owes you {fmt(c.receivable || 0)}</span>}
                      {(c.receivable || 0) > 0 && (c.payable || 0) > 0 && <span className="text-muted-42"> · </span>}
                      {(c.payable || 0) > 0 && <span className="text-negative-text">you owe {fmt(c.payable || 0)}</span>}
                      {!(c.receivable || 0) && !(c.payable || 0) && <span>settled</span>}
                    </div>
                    <span className="w-3.5 flex-none text-right text-muted-42" aria-hidden="true">
                      →
                    </span>
                  </div>
                ))}
              </div>
              {matches.length > PICKS && (
                <div className="mt-2 text-meta font-normal text-muted-60">
                  Showing the first {PICKS} of {matches.length}. Keep typing to narrow it down, or browse the full list below.
                </div>
              )}
            </>
          ) : (
            <div className="mt-3 rounded-control border border-border bg-surface-sunken px-3 py-3 text-body font-normal text-muted-70">
              No customer matches “{search.trim()}”.
              {archivedCount > 0 && !showArchived && ' Archived customers are hidden — turn "Show archived" on to include them.'}
            </div>
          )
        ) : (
          <div className="mt-3 text-body font-normal text-muted-60">
            {visible.length === 0 ? 'No customers on file yet.' : 'Type part of a name to see matching customers. Nothing is listed until you do.'}
          </div>
        )}
      </Card>

      {/* The full table is never removed, only moved behind an explicit choice. */}
      <div className="mt-3 flex items-center justify-between gap-2.5 rounded-control border border-border bg-surface-sunken px-3 py-2.5">
        <span className="text-meta font-normal text-muted-70">Would rather scan the whole book?</span>
        <Button variant="secondary" size="sm" disabled={visible.length === 0} onClick={() => setBrowseAll(true)}>
          <Users size={13} strokeWidth={2} aria-hidden="true" />
          Browse all {visible.length} customer{visible.length === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  )
}

function CustomerTable({ rows, onOpen }: { rows: CustomerRow[]; onOpen: (id: string) => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
        <div className="flex-1">Customer</div>
        <div className="min-w-[130px] text-right">Owed to you</div>
        <div className="min-w-[130px] text-right">You owe</div>
        <div className="min-w-[80px] text-right">Last activity</div>
        <div className="w-3.5" />
      </div>
      {rows.map((c) => (
        <div key={c.id} onClick={() => onOpen(c.id)} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2.5 transition-colors duration-150 hover:bg-surface-hover">
          <div className="flex flex-1 items-center gap-1.5">
            <span className="text-body font-semibold">{c.name}</span>
            {c.archived && <Badge variant="neutral">Archived</Badge>}
          </div>
          <div className={`tabular min-w-[130px] text-right text-body font-medium ${(c.receivable || 0) > 0 ? 'text-positive' : 'text-muted-60'}`}>{fmt(c.receivable || 0)}</div>
          <div className={`tabular min-w-[130px] text-right text-body font-medium ${(c.payable || 0) > 0 ? 'text-negative' : 'text-muted-60'}`}>{fmt(c.payable || 0)}</div>
          <div className="min-w-[80px] text-right text-meta font-normal text-muted-60">{c.lastActivity}</div>
          <div className="w-3.5 text-muted-42" aria-hidden="true">
            →
          </div>
        </div>
      ))}
    </Card>
  )
}
