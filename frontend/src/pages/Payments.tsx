import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownCircle, ArrowUpCircle, SearchX } from 'lucide-react'
import { useStore } from '@/lib/store'
import { activityDate, auditLine, rangeBounds, stampTime } from '@/lib/engine'
import { fmtLongDate, txnAmountParts } from '@/lib/format'
import { ACTIVITY_META } from '@/lib/ui-helpers'
import type { ReportPreset } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PeriodFilter, type PeriodPreset } from '@/components/PeriodFilter'
import { cn } from '@/lib/utils'

const PRESETS: PeriodPreset[] = [
  { key: '7d', label: 'Last 7 days' },
  { key: '10d', label: 'Last 10 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
]

// ONE definition of each column's width, used by the header AND the rows — same discipline as
// Transactions.tsx's own COL, adopted here after this table grew a Date column wide enough to
// hold "Sep 15, 2026" instead of "2 days ago". Widened all round (not just Date) and the row
// gap doubled (gap-2.5 -> gap-4): this ledger gets scanned quickly, and cramped columns are how
// a figure or a date gets misread under time pressure.
const COL = {
  type: 'w-[108px] flex-none',
  party: 'min-w-0 flex-1',
  method: 'w-[90px] flex-none',
  amount: 'w-[130px] flex-none text-right',
  date: 'w-[104px] flex-none text-right',
} as const

export function Payments() {
  const { state } = useStore()
  const navigate = useNavigate()

  const [preset, setPreset] = useState<ReportPreset>('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const allRows = useMemo(() => state.activity.filter((t) => t.type === 'receive' || t.type === 'pay'), [state.activity])

  const bounds = useMemo(() => rangeBounds(preset === 'custom' ? (from || to ? 'custom' : 'all') : preset, from, to), [preset, from, to])
  const rows = useMemo(() => {
    const t0 = bounds.fromT
    const t1 = bounds.toT
    return allRows.filter((t) => {
      const s = stampTime(activityDate(t))
      return s >= t0 && s <= t1
    })
  }, [allRows, bounds])

  function pick(key: ReportPreset) {
    setPreset(key)
    if (key !== 'custom') {
      setFrom('')
      setTo('')
    }
  }

  return (
    <div>
      <div className="mb-[26px] flex items-center justify-between gap-2.5">
        <h1 className="m-0 text-heading font-semibold">Payments</h1>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => navigate('/receive')}>
            <ArrowDownCircle size={14} strokeWidth={2} aria-hidden="true" />
            Receive Payment
          </Button>
          <Button variant="secondary" onClick={() => navigate('/pay')}>
            <ArrowUpCircle size={14} strokeWidth={2} aria-hidden="true" />
            Make Payment
          </Button>
        </div>
      </div>

      <PeriodFilter
        presets={PRESETS}
        preset={preset}
        from={from}
        to={to}
        onPick={pick}
        onFromChange={(v) => {
          setFrom(v)
          setPreset('custom')
        }}
        onToChange={(v) => {
          setTo(v)
          setPreset('custom')
        }}
        onClear={() => {
          setFrom('')
          setTo('')
          setPreset('month')
        }}
        className="mb-3"
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className="flex items-center gap-4 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
              <div className={COL.type}>Type</div>
              <div className={COL.party}>Customer</div>
              <div className={COL.method}>Method</div>
              <div className={COL.amount}>Amount</div>
              <div className={COL.date}>Date</div>
            </div>
            {rows.map((t) => {
              const meta = ACTIVITY_META[t.type]
              const Icon = meta.icon
              return (
                <div
                  key={t.id}
                  onClick={() => t.customerId && navigate(`/customers/${t.customerId}`)}
                  className="flex cursor-pointer items-center gap-4 border-b border-divider px-[13px] py-2.5 transition-colors duration-150 hover:bg-surface-hover"
                >
                  <div className={cn(COL.type, 'flex items-center gap-1.5')}>
                    <div className="flex h-5 w-5 flex-none items-center justify-center rounded-data" style={{ background: meta.chipBg, color: meta.chipColor }}>
                      <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
                    </div>
                    <span className="text-body font-medium">{meta.label}</span>
                  </div>
                  <div className={cn(COL.party, 'truncate text-body font-semibold')} title={t.customerName}>
                    {t.customerName}
                  </div>
                  <div className={cn(COL.method, 'text-body font-normal text-muted-70')}>{t.method}</div>
                  {/* Routed through the same helper as every other screen. Receipts and payments move
                      rupees and nothing else, so it returns the rupee amount with no conversion line —
                      the uniformity is the point, not a change in what this shows. */}
                  <div className={cn(COL.amount, 'tabular text-body font-medium')}>{txnAmountParts(t).primary}</div>
                  {/* Absolute date as the primary and only text, same fix already applied to the
                      Transactions table — a ledger row needs an unambiguous date, not one that
                      depends on when it's read. Full audit line (who + exact time) in the tooltip. */}
                  <div className={cn(COL.date, 'whitespace-nowrap text-meta font-normal text-muted-70')} title={auditLine(t)}>
                    {fmtLongDate(activityDate(t))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </Card>

      {rows.length === 0 && allRows.length === 0 && (
        <EmptyState
          category="customers"
          icon={ArrowDownCircle}
          title="No payments recorded yet"
          description="Payments settle a specific receivable or payable. Record the first one to see it here."
          action={
            <Button variant="primary" onClick={() => navigate('/receive')}>
              <ArrowDownCircle size={14} strokeWidth={2} aria-hidden="true" />
              Receive Payment
            </Button>
          }
        />
      )}
      {rows.length === 0 && allRows.length > 0 && <EmptyState category="customers" icon={SearchX} title="No payments in this period." />}
    </div>
  )
}
