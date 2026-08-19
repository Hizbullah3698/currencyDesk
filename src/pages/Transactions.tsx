import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { auditLine, relLabel } from '@/lib/engine'
import { fmt } from '@/lib/format'
import { ACTIVITY_META, CHEQUE_META, JOURNAL_META, CHEQUE_STATUS_STYLE } from '@/lib/ui-helpers'

type Filter = 'all' | 'sale' | 'purchase' | 'payment' | 'cheque' | 'journal'

interface Row {
  id: string
  ref: string
  type: string
  meta: (typeof ACTIVITY_META)[keyof typeof ACTIVITY_META]
  who: string
  detail: string
  status: string
  statusStyle: { bg: string; color: string }
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
      const status = cheque ? cheque.status : t.outstanding ? 'Open' : 'Settled'
      const style = cheque ? CHEQUE_STATUS_STYLE[cheque.status] : t.outstanding ? CHEQUE_STATUS_STYLE.Pending : CHEQUE_STATUS_STYLE.Cleared
      const detail = t.type === 'sale' || t.type === 'purchase' ? `${t.amount?.toLocaleString('en-US')} ${t.currency} @ ${t.rate} · ${t.method}` : `via ${t.method}`
      return { id: t.id, ref: t.id.toUpperCase(), type: t.type === 'sale' || t.type === 'purchase' ? t.type : 'payment', meta, who: t.customerName, detail, status, statusStyle: style, amount: t.pkrValue, date: t.createdAt, audit: auditLine(t), customerId: t.customerId }
    })
    const chequeRows: Row[] = state.cheques.map((q) => ({
      id: q.id,
      ref: q.id.toUpperCase(),
      type: 'cheque',
      meta: CHEQUE_META,
      who: q.party,
      detail: `${q.direction} · ${q.bank} · ${q.number}`,
      status: q.status,
      statusStyle: CHEQUE_STATUS_STYLE[q.status],
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
      statusStyle: CHEQUE_STATUS_STYLE.Cleared,
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
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <h1 className="m-0 text-[17px] font-semibold">Transactions</h1>
        <div className="inline-flex gap-1.5">
          {chips.map((c) => (
            <button key={c.key} onClick={() => setFilter(c.key)} className={`rounded-[6px] px-2.5 py-1.5 text-[12px] font-semibold ${filter === c.key ? 'border border-accent bg-accent-bg text-accent' : 'border border-border-input bg-surface text-ink'}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-[8px] border border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-[64px]">Ref</div>
          <div className="min-w-[86px]">Type</div>
          <div className="flex-1">Party</div>
          <div className="min-w-[200px]">Detail</div>
          <div className="min-w-[78px]">Status</div>
          <div className="min-w-[110px] text-right">Amount</div>
          <div className="min-w-[62px] text-right">Date</div>
        </div>
        {rows.map((r) => {
          const Icon = r.meta.icon
          return (
            <div key={r.type + r.id} onClick={() => r.customerId && navigate(`/customers/${r.customerId}`)} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2 hover:bg-surface-hover">
              <div className="tabular min-w-[64px] text-[11.5px] text-muted-60">{r.ref}</div>
              <div className="flex min-w-[102px] items-center gap-1.5">
                <div className="flex h-5 w-5 flex-none items-center justify-center rounded-[5px]" style={{ background: r.meta.chipBg, color: r.meta.chipColor }}>
                  <Icon size={13} strokeWidth={2.2} />
                </div>
                <span className="text-[12px] font-semibold text-ink">{r.meta.label}</span>
              </div>
              <div className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{r.who}</div>
              <div className="min-w-[200px] truncate text-[12px] text-muted-70">{r.detail}</div>
              <div className="min-w-[78px]">
                <span className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: r.statusStyle.bg, color: r.statusStyle.color }}>
                  {r.status}
                </span>
              </div>
              <div className="tabular min-w-[110px] text-right text-[12.5px] font-medium">{fmt(r.amount)}</div>
              <div className="flex min-w-[78px] items-center justify-end gap-1 text-[11px] text-muted-60" title={r.audit}>
                {relLabel(r.date)}
              </div>
            </div>
          )
        })}
      </div>
      {rows.length === 0 && <div className="py-9 text-center text-[12.5px] text-muted-60">No transactions match this filter.</div>}
    </div>
  )
}
