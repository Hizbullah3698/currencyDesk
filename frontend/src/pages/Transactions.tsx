import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { useStore } from '@/lib/store'
import { activityDate, auditLine, isVoucherLeg, relLabel, stampTime, txnIsOpen } from '@/lib/engine'
import { fmt, fmtAmount, fmtLongDate, fmtRate, shortRef, txnAmountParts, type TxnAmountParts } from '@/lib/format'
import { ACTIVITY_META, CHEQUE_META, JOURNAL_META, statusMeta } from '@/lib/ui-helpers'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

/**
 * `relLabel` is shared with Customers/Payments/CustomerDetail and its own behaviour stays
 * untouched — this just decides whether ITS OUTPUT is worth printing as a secondary line here.
 * Once a date is old enough, `relLabel` itself falls back to a short absolute date, and echoing
 * that back under the real (long) absolute date would just repeat the same fact in two formats
 * side by side. Only "Today" / "Yesterday" / "N days ago" earn the secondary line.
 */
function recentLabel(iso: string): string | null {
  const r = relLabel(iso)
  return r === 'Today' || r === 'Yesterday' || /^\d+ days ago$/.test(r) ? r : null
}

type Filter = 'all' | 'sale' | 'purchase' | 'payment' | 'cheque' | 'journal'

// ONE definition of each column's width, used by the header AND the rows.
//
// They were two separate sets of classes and had drifted: Type was 86px in the header against
// 102px in the rows, Amount 110 against 130, Date 62 against 78. Every header label after Ref
// therefore sat some way to the left of the column it named, which is most of why this table read
// as "so close you can't differentiate" (reported 2026-09-09). Widths that must agree should not
// be written down twice.
// Detail widened (200 -> 248) now that it no longer carries "· Credit"/"· Cash" on every trade
// row — that moved into its own badge next to Status, see `terms` below. Date widened (78 -> 96)
// to fit an unambiguous absolute date ("Sep 15, 2026") rather than the "3 days ago" it used to
// hold; a relative label, when one is worth showing, now stacks under it instead of replacing it.
const COL = {
  ref: 'w-[78px] flex-none',
  type: 'w-[102px] flex-none',
  party: 'min-w-0 flex-1',
  detail: 'w-[248px] flex-none',
  status: 'w-[100px] flex-none',
  amount: 'w-[130px] flex-none text-right',
  date: 'w-[96px] flex-none text-right',
} as const

interface Row {
  id: string
  ref: string
  /** The untruncated reference, shown on hover — see shortRef. */
  refFull: string
  type: string
  meta: (typeof ACTIVITY_META)[keyof typeof ACTIVITY_META]
  who: string
  detail: string
  /** Cash/Bank/Cheque/Credit, purchase and sale rows only — pulled out of `detail` into its own
   *  small badge so a long IRR amount + rate string never has to compete with it for the same
   *  cramped cell. Null everywhere else: a payment's own method is already the whole of its detail
   *  string ("via Bank"), and a cheque/journal row has no comparable "terms" concept at all. */
  terms: string | null
  status: string
  /** Pre-split into what was actually dealt and its rupee equivalent, so the list never leads with
   *  a converted figure for a foreign-currency trade. See txnAmountParts in lib/format.ts. */
  money: TxnAmountParts
  /** What the Date column shows: the date the deal was struck for a trade (activityDate), the
   *  row's own timestamp for a cheque or journal entry, which have no separate deal date. */
  date: string
  /** "Today" / "Yesterday" / "N days ago" — only when `date` is recent enough for that to add
   *  something beyond the absolute date now shown as the primary value. Null otherwise. */
  dateRel: string | null
  /** What the list is ORDERED by — always the posting timestamp, so the list reads as the order
   *  things were actually keyed in and a backdated deal doesn't silently jump the queue. Unrelated
   *  to how the Date column is now LABELLED (an absolute date, not this timestamp's raw string) —
   *  the display changed, the sort key that drives row order did not. */
  sortT: number
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
      const code = t.currency || 'AED'
      const isTrade = t.type === 'sale' || t.type === 'purchase'
      // Rates print in the traded currency's own quote convention (PKR per 1 AED, but IRR per 1
      // PKR) — never as a bare stored number, which is meaningless without the convention. Method
      // ("Credit", currently the only one live — see Trade.tsx) is deliberately NOT concatenated
      // in here any more: an IRR amount already runs to nine figures, and appending "· Credit" to
      // that was exactly what forced the mid-word ellipsis. It's carried separately as `terms`.
      const detail = isTrade ? `${fmtAmount(t.amount || 0, code)} ${code} @ ${fmtRate(t.rate || 0, code)}` : `via ${t.method}`
      return {
        id: t.id,
        ref: shortRef(t.id),
        refFull: t.id.toUpperCase(),
        type: isTrade ? t.type : 'payment',
        meta,
        who: t.customerName,
        detail,
        terms: isTrade ? t.method : null,
        status,
        money: txnAmountParts(t),
        date: activityDate(t),
        dateRel: recentLabel(activityDate(t)),
        sortT: stampTime(t.createdAt),
        audit: auditLine(t),
        customerId: t.customerId,
      }
    })
    const chequeRows: Row[] = state.cheques.map((q) => ({
      id: q.id,
      ref: shortRef(q.id),
      refFull: q.id.toUpperCase(),
      type: 'cheque',
      meta: CHEQUE_META,
      who: q.party,
      detail: `${q.direction} · ${q.bank} · ${q.number}`,
      terms: null,
      status: q.status,
      money: { primary: fmt(q.amount), secondary: null },
      date: q.createdAt,
      dateRel: recentLabel(q.createdAt),
      sortT: stampTime(q.createdAt),
      audit: auditLine(q),
      customerId: q.customerId,
    }))
    // Voucher legs are the bookkeeping behind a trade, not events in their own right — the trade
    // already appears in this list as its activity row. Listing both would show one deal twice.
    const journalRows: Row[] = state.journalEntries.filter((e) => !isVoucherLeg(e)).map((e) => ({
      id: e.id,
      ref: e.ref,
      refFull: e.ref,
      type: 'journal',
      meta: JOURNAL_META,
      who: e.narration,
      detail: `Dr ${e.debitLabel} · Cr ${e.creditLabel}`,
      terms: null,
      status: 'Posted',
      money: { primary: fmt(e.amount), secondary: null },
      date: e.createdAt,
      dateRel: recentLabel(e.createdAt),
      sortT: stampTime(e.createdAt),
      audit: auditLine(e),
      customerId: null,
    }))
    const all = [...txnRows, ...chequeRows, ...journalRows].sort((a, b) => b.sortT - a.sortT)
    if (filter === 'all') return all
    if (filter === 'sale') return all.filter((r) => r.type === 'sale')
    if (filter === 'purchase') return all.filter((r) => r.type === 'purchase')
    if (filter === 'payment') return all.filter((r) => r.type === 'payment')
    if (filter === 'cheque') return all.filter((r) => r.type === 'cheque')
    return all.filter((r) => r.type === 'journal')
  }, [state.activity, state.accounts, state.cheques, state.journalEntries, filter])

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
      {/* overflow-x-auto + a min-width on the scrolling content: at a narrow viewport (tablet,
          ~768px) seven fixed-width columns plus a usable Party column don't fit, and the old
          behaviour there was silent clipping — content cut off with no way to reach it. Scrolling
          sideways to it is the honest fix; nothing about the 1280px+ desktop layout below changes,
          since the content's natural width already exceeds the scroll container there and no
          scrollbar appears. Card keeps its own overflow-hidden for the rounded corners/border;
          the horizontal scroll lives one level in, on the content itself. */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[970px]">
            <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
              <div className={COL.ref}>Ref</div>
              <div className={COL.type}>Type</div>
              <div className={COL.party}>Party</div>
              <div className={COL.detail}>Detail</div>
              <div className={COL.status}>Status</div>
              <div className={COL.amount}>Amount</div>
              <div className={COL.date}>Date</div>
            </div>
            {rows.map((r) => {
              const Icon = r.meta.icon
              const status = statusMeta(r.status)
              const StatusIcon = status.icon
              return (
                <div key={r.type + r.id} onClick={() => r.customerId && navigate(`/customers/${r.customerId}`)} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2 transition-colors duration-150 hover:bg-surface-hover">
                  {/* Monospace, not just small/muted: the font itself signals "this is a code,
                      not a word" — the same job IBM Plex Mono already does for rate/amount boxes
                      elsewhere. Still truncate+title, in case a future id format runs longer than
                      this column. */}
                  <div className={cn(COL.ref, 'tabular truncate font-mono text-meta font-normal text-muted-60')} title={r.refFull}>
                    {r.ref}
                  </div>
                  <div className={cn(COL.type, 'flex items-center gap-1.5')}>
                    <div className="flex h-5 w-5 flex-none items-center justify-center rounded-data" style={{ background: r.meta.chipBg, color: r.meta.chipColor }}>
                      <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
                    </div>
                    <span className="text-body font-medium text-ink">{r.meta.label}</span>
                  </div>
                  <div className={cn(COL.party, 'truncate text-body font-semibold')} title={r.who}>
                    {r.who}
                  </div>
                  {/* title carries the full string as a safety net — the column is now sized for
                      the realistic worst case (a nine-figure IRR amount @ its rate), but nothing
                      here should ever truncate without a way to still read the whole value. */}
                  <div className={cn(COL.detail, 'truncate text-body font-normal text-muted-70')} title={r.detail}>
                    {r.detail}
                  </div>
                  <div className={cn(COL.status, 'flex flex-col items-start gap-1')}>
                    <Badge variant={status.variant}>
                      <StatusIcon size={10} strokeWidth={2.4} aria-hidden="true" />
                      {r.status}
                    </Badge>
                    {/* Payment terms, moved out of Detail (see the `terms` field's own comment) —
                        neutral, not colored: Credit/Cash is a fact about how the deal settles, not
                        a state judgement the way the Status badge above it is. */}
                    {r.terms && <Badge variant="neutral">{r.terms}</Badge>}
                  </div>
                  <div className={COL.amount}>
                    <div className="tabular text-body font-medium">{r.money.primary}</div>
                    {r.money.secondary && <div className="tabular text-meta font-normal text-muted-60">{r.money.secondary}</div>}
                  </div>
                  {/* Absolute date is now the PRIMARY value — a relative label ("Today") is a
                      convenience, never the only thing on the row, per the ledger-data rule this
                      column exists to fix. `title` still carries the full audit line (who, plus
                      exact date AND time via fmtDateTime), so the precision that mattered before
                      is not lost, just no longer the only thing legible without hovering. Sort
                      order is untouched — still `sortT`, the posting timestamp, never this string. */}
                  <div className={cn(COL.date, 'flex flex-col items-end justify-center')} title={r.audit}>
                    <div className="tabular text-meta font-medium text-muted-70">{fmtLongDate(r.date)}</div>
                    {r.dateRel && <div className="text-meta font-normal text-muted-60">{r.dateRel}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </Card>
      {rows.length === 0 && <EmptyState category="neutral" icon={SearchX} title="No transactions match this filter." />}
    </div>
  )
}
