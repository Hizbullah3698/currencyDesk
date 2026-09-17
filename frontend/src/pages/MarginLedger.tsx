import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Printer, ArrowUpDown, Lock, LockOpen, SearchX } from 'lucide-react'
import { useStore } from '@/lib/store'
import { rangeBounds, marginLedger, currencyName, activityDate, stampTime, fmtDateTime, isClosedPeriod, periodLabel } from '@/lib/engine'
import { fmt, fmtAmount, fmtQuote, fmtRate, fmtLongDate, todayISO } from '@/lib/format'
import type { ReportPreset } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/date-picker'
import { SignedAmount } from '@/components/ui/signed-amount'
import { EmptyState } from '@/components/ui/empty-state'
import { PrintHeader } from '@/components/PrintHeader'
import { cn } from '@/lib/utils'

const PRESETS: { key: ReportPreset; label: string }[] = [
  { key: '7d', label: 'Last 7 days' },
  { key: '10d', label: 'Last 10 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
]

type SortKey = 'date' | 'marginDesc' | 'marginAsc'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'marginDesc', label: 'Highest margin' },
  { key: 'marginAsc', label: 'Lowest margin' },
]

// Column widths shared between the header and the rows — see Transactions.tsx's own COL for why
// this must not be two separate sets of classes.
const COL = {
  date: 'w-[100px] flex-none',
  party: 'min-w-0 flex-1',
  currency: 'w-[72px] flex-none',
  amount: 'w-[130px] flex-none text-right',
  buyRate: 'w-[110px] flex-none text-right',
  sellRate: 'w-[110px] flex-none text-right',
  margin: 'w-[140px] flex-none text-right',
} as const

export function MarginLedger() {
  const { state, closePeriod, reopenPeriod } = useStore()
  const navigate = useNavigate()

  const [preset, setPreset] = useState<ReportPreset>('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')

  const [closeMonth, setCloseMonth] = useState(() => todayISO().slice(0, 7))
  const [periodMsg, setPeriodMsg] = useState('')
  const [periodBusy, setPeriodBusy] = useState(false)

  const bounds = useMemo(() => rangeBounds(preset === 'custom' ? (from || to ? 'custom' : 'all') : preset, from, to), [preset, from, to])

  // Sales margin only — deliberately the same call reports.ts's balance sheet branch makes for
  // the identical purpose ([] for journalEntries), since this page is about realized deal margin,
  // not the Income Statement's broader "gross profit including manual journal postings to Income".
  const margin = useMemo(
    () => marginLedger(state.accounts, state.activity, [], state.stocks, (iso) => stampTime(iso) >= bounds.fromT && stampTime(iso) <= bounds.toT),
    [state.accounts, state.activity, state.stocks, bounds],
  )

  const rows = useMemo(() => {
    const sorted = [...margin.sales]
    if (sortKey === 'date') sorted.sort((a, b) => stampTime(activityDate(b)) - stampTime(activityDate(a)))
    else if (sortKey === 'marginDesc') sorted.sort((a, b) => (b.margin || 0) - (a.margin || 0))
    else sorted.sort((a, b) => (a.margin || 0) - (b.margin || 0))
    return sorted
  }, [margin.sales, sortKey])

  const currencyRows = margin.byCurrency.filter((c) => c.count > 0)
  const rangeActive = !!(from || to)

  function pick(key: ReportPreset) {
    setPreset(key)
    if (key !== 'custom') {
      setFrom('')
      setTo('')
    }
  }

  async function doClose() {
    setPeriodBusy(true)
    setPeriodMsg(await closePeriod(closeMonth))
    setPeriodBusy(false)
  }
  async function doReopen(id: string) {
    setPeriodBusy(true)
    setPeriodMsg(await reopenPeriod(id))
    setPeriodBusy(false)
  }

  return (
    <div className="max-w-[860px] print:max-w-none">
      <PrintHeader title="Margin Ledger" period={`Showing ${bounds.label}.`} />

      <div className="flex items-start justify-between gap-3 print:hidden">
        <h1 className="m-0 mb-[3px] font-serif text-report font-normal tracking-tight">Margin Ledger</h1>
        <Button variant="secondary" size="sm" className="whitespace-nowrap text-meta font-medium" onClick={() => window.print()}>
          <Printer size={13} strokeWidth={2} aria-hidden="true" />
          Print
        </Button>
      </div>
      <div className="mb-3 text-body font-normal text-muted-60 print:hidden">Realized margin on every currency sale, at the weighted-average cost recorded when it was sold.</div>

      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-meta font-medium uppercase tracking-wide text-muted-60">Period</span>
        {PRESETS.map((p) => (
          <Button
            key={p.key}
            type="button"
            variant="secondary"
            size="sm"
            aria-pressed={preset === p.key && !rangeActive}
            onClick={() => pick(p.key)}
            className={cn('text-meta', preset === p.key && !rangeActive && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
          >
            {p.label}
          </Button>
        ))}
        <span className="h-5 w-px bg-border" aria-hidden="true" />
        <DatePicker
          value={from}
          onChange={(v) => {
            setFrom(v)
            setPreset('custom')
          }}
          placeholder="From"
        />
        <span className="text-meta font-normal text-muted-60">to</span>
        <DatePicker
          value={to}
          onChange={(v) => {
            setTo(v)
            setPreset('custom')
          }}
          placeholder="To"
        />
        {rangeActive && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="text-meta"
            onClick={() => {
              setFrom('')
              setTo('')
              setPreset('month')
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <Card className="mb-4 overflow-hidden print:border-0 print:shadow-none">
        <div className="flex items-center gap-2.5 border-b border-divider bg-surface-sunken px-[13px] py-2.5">
          <div className="flex-1">
            <div className="text-body font-bold">Total margin for selected period</div>
            <div className="text-meta font-normal text-muted-60">
              {bounds.label} · {rows.length} sale{rows.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className="tabular text-heading font-bold">
            <SignedAmount value={margin.salesMargin} />
          </div>
        </div>
        {currencyRows.length > 1 &&
          currencyRows.map((c) => (
            <div key={c.code} className="flex items-center gap-2.5 border-b border-divider py-2 pl-5 pr-[13px] last:border-b-0">
              <div className="flex-1">
                <div className="text-body font-medium">
                  {currencyName(c.code)} ({c.code})
                </div>
                <div className="text-meta font-normal text-muted-60">
                  {c.count} sale{c.count === 1 ? '' : 's'} · {fmtAmount(c.qty, c.code)} {c.code} sold
                </div>
              </div>
              <div className="tabular text-body font-semibold">
                <SignedAmount value={c.margin} />
              </div>
            </div>
          ))}
      </Card>

      <div className="mb-2 flex items-center justify-between gap-2 print:hidden">
        <span className="text-meta font-medium uppercase tracking-wide text-muted-60">Sales</span>
        <div className="flex items-center gap-1.5">
          <ArrowUpDown size={12} strokeWidth={2.2} className="text-muted-60" aria-hidden="true" />
          {SORTS.map((s) => (
            <Button
              key={s.key}
              type="button"
              variant="secondary"
              size="sm"
              aria-pressed={sortKey === s.key}
              onClick={() => setSortKey(s.key)}
              className={cn('text-meta', sortKey === s.key && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      <Card className="mb-6 overflow-hidden print:border-0 print:shadow-none">
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
              <div className={COL.date}>Date</div>
              <div className={COL.party}>Party</div>
              <div className={COL.currency}>Currency</div>
              <div className={COL.amount}>Amount</div>
              <div className={COL.buyRate}>Buy Rate</div>
              <div className={COL.sellRate}>Sell Rate</div>
              <div className={COL.margin}>Margin</div>
            </div>
            {rows.map((t) => {
              const code = t.currency || 'AED'
              // Cost basis is the desk's single weighted-average PKR-per-unit at the moment of
              // sale (t.cost / t.amount) — same figure the Sale screen's "Bought at" readout and
              // the persisted t.cost both come from, converted to the currency's own display
              // convention exactly like fmtQuote does everywhere else in the app.
              const buyRate = t.amount ? fmtQuote(code, (t.cost || 0) / t.amount) : '—'
              return (
                <div
                  key={t.id}
                  onClick={() => t.customerId && navigate(`/customers/${t.customerId}`)}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2 transition-colors duration-150 last:border-b-0 hover:bg-surface-hover"
                >
                  <div className={cn(COL.date, 'whitespace-nowrap text-meta font-normal text-muted-70')} title={fmtDateTime(t.createdAt)}>
                    {fmtLongDate(activityDate(t))}
                  </div>
                  <div className={cn(COL.party, 'truncate text-body font-semibold')} title={t.customerName}>
                    {t.customerName}
                  </div>
                  <div className={cn(COL.currency, 'text-body font-medium text-muted-70')}>{code}</div>
                  <div className={cn(COL.amount, 'tabular text-body font-medium')}>
                    {fmtAmount(t.amount, code)} {code}
                  </div>
                  <div className={cn(COL.buyRate, 'tabular text-body font-normal text-muted-70')}>{buyRate}</div>
                  <div className={cn(COL.sellRate, 'tabular text-body font-normal text-muted-70')}>{fmtRate(t.rate || 0, code)}</div>
                  <div className={COL.margin}>
                    <SignedAmount value={t.margin || 0} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </Card>
      {rows.length === 0 && <EmptyState category="reports" icon={SearchX} title="No sales in this period." className="print:hidden" />}

      <Card className="print:hidden">
        <div className="border-b border-divider px-[13px] py-2.5">
          <div className="text-body font-bold">Period Close</div>
          <div className="text-meta font-normal text-muted-60">
            Locks a calendar month's Sale/Purchase trades from being backdated into it and freezes that month's realized margin. Scoped to trades only — manual journal entries are unaffected.
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-b border-divider px-[13px] py-2.5">
          <div>
            <div className="mb-1 text-meta font-semibold uppercase tracking-wide text-muted-60">Month</div>
            <Input type="month" value={closeMonth} max={todayISO().slice(0, 7)} onChange={(e) => setCloseMonth(e.target.value)} className="w-[160px]" />
          </div>
          <Button type="button" size="sm" disabled={periodBusy || !closeMonth} onClick={doClose}>
            <Lock size={13} strokeWidth={2.2} aria-hidden="true" />
            Close Period
          </Button>
          {periodMsg && <span className="text-meta font-normal text-negative">{periodMsg}</span>}
        </div>

        {state.periods.length === 0 ? (
          <div className="px-[13px] py-4 text-body font-normal text-muted-60">No periods closed yet.</div>
        ) : (
          state.periods.map((p) => {
            const closed = isClosedPeriod(p)
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-2.5 border-b border-divider px-[13px] py-2 last:border-b-0">
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 text-body font-semibold">
                    {periodLabel(p.id)}
                    <Badge variant={closed ? 'pending' : 'neutral'}>
                      {closed ? <Lock size={10} strokeWidth={2.4} aria-hidden="true" /> : <LockOpen size={10} strokeWidth={2.4} aria-hidden="true" />}
                      {closed ? 'Closed' : 'Reopened'}
                    </Badge>
                  </div>
                  <div className="text-meta font-normal text-muted-60">
                    {closed ? `Closed by ${p.closedBy} on ${fmtDateTime(p.closedAt)}` : `Reopened by ${p.reopenedBy} on ${fmtDateTime(p.reopenedAt)} · last closed ${fmtDateTime(p.closedAt)}`}
                  </div>
                </div>
                <div className="tabular text-body font-semibold">{fmt(p.closedMargin)}</div>
                {closed && (
                  <Button type="button" variant="secondary" size="sm" disabled={periodBusy} onClick={() => doReopen(p.id)}>
                    <LockOpen size={13} strokeWidth={2.2} aria-hidden="true" />
                    Reopen
                  </Button>
                )}
              </div>
            )
          })
        )}
      </Card>
    </div>
  )
}
