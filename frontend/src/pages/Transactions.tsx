import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { useStore } from '@/lib/store'
import { auditLine, relLabel, txnIsOpen } from '@/lib/engine'
import { fmt } from '@/lib/format'
import { ACTIVITY_META, CHEQUE_META, JOURNAL_META, statusMeta } from '@/lib/ui-helpers'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'sale' | 'purchase' | 'payment' | 'cheque' | 'journal'

interface Row {
  id: string
  ref: string
  type: string
  meta: (typeof ACTIVITY_META)[keyof typeof ACTIVITY_META]
  who: string
  detail: string
  status: string
  amount: number
  date: string
  audit: string
  customerId: string | null
}

export function Transactions() {
  const { state, isAdmin } = useStore()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')

  const rows: Row[] = useMemo(() => {
    const txnRows: Row[] = state.activity.map((t) => {
      const meta = ACTIVITY_META[t.type]
      const cheque = t.chequeId ? state.cheques.find((q) => q.id === t.chequeId) : undefined
      const status = cheque ? cheque.status : txnIsOpen(t, state.accounts) ? 'Open' : 'Settled'
      const detail = t.type === 'sale' || t.type === 'purchase' ? `${t.amount?.toLocaleString('en-US')} ${t.currency} @ ${t.rate} · ${t.method}` : `via ${t.method}`
      return { id: t.id, ref: t.id.toUpperCase(), type: t.type === 'sale' || t.type === 'purchase' ? t.type : 'payment', meta, who: t.customerName, detail, status, amount: t.pkrValue, date: t.createdAt, audit: auditLine(t), customerId: t.customerId }
    })
    const chequeRows: Row[] = state.cheques.map((q) => ({
      id: q.id,
      ref: q.id.toUpperCase(),
      type: 'cheque',
      meta: CHEQUE_META,
      who: q.party,
      detail: `${q.direction} · ${q.bank} · ${q.number}`,
      status: q.status,
      amount: q.amount,
      date: q.createdAt,
      audit: auditLine(q),
      customerId: q.customerId,
    }))
    const journalRows: Row[] = state.journalEntries.map((e) => ({
      id: e.id,
      ref: e.ref,
      type: 'journal',
      meta: JOURNAL_META,
      who: e.narration,
      detail: `Dr ${e.debitLabel} · Cr ${e.creditLabel}`,
      status: 'Posted',
      amount: e.amount,
      date: e.createdAt,
      audit: auditLine(e),
      customerId: null,
    }))
    const all = [...txnRows, ...chequeRows, ...journalRows].sort((a, b) => +new Date(b.date) - +new Date(a.date))
    if (filter === 'all') return all
    if (filter === 'sale') return all.filter((r) => r.type === 'sale')
    if (filter === 'purchase') return all.filter((r) => r.type === 'purchase')
    if (filter === 'payment') return all.filter((r) => r.type === 'payment')
    if (filter === 'cheque') return all.filter((r) => r.type === 'cheque')
    return all.filter((r) => r.type === 'journal')
  }, [state.activity, state.cheques, state.journalEntries, filter])

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'sale', label: 'Sales' },
    { key: 'purchase', label: 'Purchases' },
    { key: 'payment', label: 'Payments' },
    { key: 'cheque', label: 'Cheques' },
    ...(isAdmin ? [{ key: 'journal' as Filter, label: 'Journal' }] : []),
  ]

  return (
    <div>
      <div className="mb-[26px] flex flex-wrap items-center justify-between gap-2.5">
        <h1 className="m-0 text-heading font-semibold">Transactions</h1>
        <div className="inline-flex gap-1.5">
          {chips.map((c) => (
            <Button
              key={c.key}
              type="button"
              variant="secondary"
              size="sm"
              aria-pressed={filter === c.key}
              onClick={() => setFilter(c.key)}
              className={cn(filter === c.key && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
            >
              {c.label}
            </Button>
          ))}
        </div>
      </div>
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-[64px]">Ref</div>
          <div className="min-w-[86px]">Type</div>
          <div className="flex-1">Party</div>
          <div className="min-w-[200px]">Detail</div>
          <div className="min-w-[100px]">Status</div>
          <div className="min-w-[110px] text-right">Amount</div>
          <div className="min-w-[62px] text-right">Date</div>
        </div>
        {rows.map((r) => {
          const Icon = r.meta.icon
          const status = statusMeta(r.status)
          const StatusIcon = status.icon
          return (
            <div key={r.type + r.id} onClick={() => r.customerId && navigate(`/customers/${r.customerId}`)} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2 transition-colors duration-150 hover:bg-surface-hover">
              <div className="tabular min-w-[64px] text-meta font-normal text-muted-60">{r.ref}</div>
              <div className="flex min-w-[102px] items-center gap-1.5">
                <div className="flex h-5 w-5 flex-none items-center justify-center rounded-data" style={{ background: r.meta.chipBg, color: r.meta.chipColor }}>
                  <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
                </div>
                <span className="text-body font-medium text-ink">{r.meta.label}</span>
              </div>
              <div className="min-w-0 flex-1 truncate text-body font-semibold">{r.who}</div>
              <div className="min-w-[200px] truncate text-body font-normal text-muted-70">{r.detail}</div>
              <div className="min-w-[100px]">
                <Badge variant={status.variant}>
                  <StatusIcon size={10} strokeWidth={2.4} aria-hidden="true" />
                  {r.status}
                </Badge>
              </div>
              <div className="tabular min-w-[110px] text-right text-body font-medium">{fmt(r.amount)}</div>
              <div className="flex min-w-[78px] items-center justify-end gap-1 text-meta font-normal text-muted-60" title={r.audit}>
                {relLabel(r.date)}
              </div>
            </div>
          )
        })}
      </Card>
      {rows.length === 0 && <EmptyState category="neutral" icon={SearchX} title="No transactions match this filter." />}
    </div>
  )
}
