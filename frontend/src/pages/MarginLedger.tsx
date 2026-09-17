import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Printer, Info, ArrowUp, ArrowDown, Lock, LockOpen, SearchX } from 'lucide-react'
import { useStore } from '@/lib/store'
import { rangeBounds, marginLedger, currencyName, activityDate, stampTime, fmtDateTime, isClosedPeriod, periodLabel } from '@/lib/engine'
import { fmt, fmtAmount, fmtQuote, fmtRate, fmtLongDate, todayISO } from '@/lib/format'
import type { Activity, ReportPreset } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { SignedAmount } from '@/components/ui/signed-amount'
import { EmptyState } from '@/components/ui/empty-state'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PrintHeader } from '@/components/PrintHeader'
import { PeriodFilter } from '@/components/PeriodFilter'
import { cn } from '@/lib/utils'

const PRESETS: { key: ReportPreset; label: string }[] = [
  { key: '7d', label: 'Last 7 days' },
  { key: '10d', label: 'Last 10 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
]

type SortKey = 'date' | 'margin'
type SortDir = 'asc' | 'desc'

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

const PERIOD_COL = {
  month: 'min-w-0 flex-1',
  status: 'w-[168px] flex-none',
  closedBy: 'w-[140px] flex-none',
  closedAt: 'w-[172px] flex-none',
  margin: 'w-[120px] flex-none text-right',
  action: 'w-[96px] flex-none text-right',
} as const

// Plain colored text for a signed margin figure — no pill/badge background. Used everywhere a
// margin appears as one line among several (a sale row, a per-currency subtotal, a closed
// period's frozen figure), so the pill styling stays reserved for the one headline total and
// doesn't compete with it for visual weight. Both tokens are dark/bright enough on a plain
// surface background to clear WCAG AA (4.5:1) in both themes — verified, not assumed.
function marginClass(v: number): string {
  if (!v) return 'text-muted-60'
  return v > 0 ? 'text-positive-text' : 'text-negative-deep'
}
function marginText(v: number): string {
  if (!v) return fmt(0)
  return (v > 0 ? '+' : '−') + fmt(Math.abs(v))
}

export function MarginLedger() {
  const { state, closePeriod, reopenPeriod } = useStore()
  const navigate = useNavigate()

  const [preset, setPreset] = useState<ReportPreset>('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

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

  // One toggle per sort key, exactly like Date/Margin column-header sorting elsewhere: clicking
  // the active key flips its direction, clicking the other key switches to it (newest/highest
  // first by default) — never two separate buttons doing one job two different ways.
  const rows = useMemo(() => {
    const sorted = [...margin.sales]
    const val = (t: Activity) => (sortKey === 'date' ? stampTime(activityDate(t)) : t.margin || 0)
    sorted.sort((a, b) => (sortDir === 'desc' ? val(b) - val(a) : val(a) - val(b)))
    return sorted
  }, [margin.sales, sortKey, sortDir])

  const currencyRows = margin.byCurrency.filter((c) => c.count > 0)

  function pick(key: ReportPreset) {
    setPreset(key)
    if (key !== 'custom') {
      setFrom('')
      setTo('')
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('desc')
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
        <h1 className="m-0 mb-[3px] text-heading font-semibold tracking-tight">Margin Ledger</h1>
        <Button variant="secondary" size="sm" className="whitespace-nowrap text-meta font-medium" onClick={() => window.print()}>
          <Printer size={13} strokeWidth={2} aria-hidden="true" />
          Print
        </Button>
      </div>
      <div className="mb-3 flex items-center gap-1 text-body font-normal text-muted-60 print:hidden">
        Profit earned on each currency sale this period.
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="inline-flex flex-none items-center rounded-control p-0.5 text-muted-60 transition-colors duration-150 hover:bg-surface-tint hover:text-ink" aria-label="How margin is calculated">
              <Info size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Calculated using weighted-average cost basis, recorded at the time of sale.</TooltipContent>
        </Tooltip>
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
        className="mb-3 print:hidden"
      />

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
              <div className={cn('tabular text-body font-semibold', marginClass(c.margin))}>{marginText(c.margin)}</div>
            </div>
          ))}
      </Card>

      <div className="mb-2 flex items-center justify-between gap-2 print:hidden">
        <span className="text-meta font-medium uppercase tracking-wide text-muted-60">Sales</span>
        <div className="flex items-center gap-1.5">
          {(['date', 'margin'] as SortKey[]).map((key) => {
            const active = sortKey === key
            const DirIcon = sortDir === 'asc' ? ArrowUp : ArrowDown
            return (
              <Button
                key={key}
                type="button"
                variant="secondary"
                size="sm"
                aria-pressed={active}
                onClick={() => toggleSort(key)}
                className={cn('text-meta', active && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
              >
                {key === 'date' ? 'Date' : 'Margin'}
                {active && <DirIcon size={12} strokeWidth={2.4} aria-hidden="true" />}
              </Button>
            )
          })}
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
                  <div className={cn(COL.margin, 'tabular text-body font-semibold', marginClass(t.margin || 0))}>{marginText(t.margin || 0)}</div>
                </div>
              )
            })}
          </div>
        </div>
      </Card>
      {rows.length === 0 && <EmptyState category="reports" icon={SearchX} title="No sales in this period." className="print:hidden" />}

      <Card className="print:hidden">
        <div className="border-b border-divider px-[13px] py-2.5">
          <div className="flex items-center gap-1 text-body font-bold">
            Period Close
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="inline-flex flex-none items-center rounded-control p-0.5 text-muted-60 transition-colors duration-150 hover:bg-surface-tint hover:text-ink" aria-label="What closing a period does">
                  <Info size={13} strokeWidth={2} aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Scoped to trades only — manual journal entries are unaffected.</TooltipContent>
            </Tooltip>
          </div>
          <div className="text-meta font-normal text-muted-60">Locks a month's sales and purchases so the numbers can't change later.</div>
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
          <div className="overflow-x-auto">
            <div className="min-w-[680px]">
              <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
                <div className={PERIOD_COL.month}>Month</div>
                <div className={PERIOD_COL.status}>Status</div>
                <div className={PERIOD_COL.closedBy}>Closed By</div>
                <div className={PERIOD_COL.closedAt}>Closed At</div>
                <div className={PERIOD_COL.margin}>Margin</div>
                <div className={PERIOD_COL.action} />
              </div>
              {state.periods.map((p) => {
                const closed = isClosedPeriod(p)
                return (
                  <div key={p.id} className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2 last:border-b-0">
                    <div className={cn(PERIOD_COL.month, 'text-body font-semibold')}>{periodLabel(p.id)}</div>
                    <div className={PERIOD_COL.status}>
                      <Badge variant={closed ? 'pending' : 'neutral'}>
                        {closed ? <Lock size={10} strokeWidth={2.4} aria-hidden="true" /> : <LockOpen size={10} strokeWidth={2.4} aria-hidden="true" />}
                        {closed ? 'Closed' : 'Reopened'}
                      </Badge>
                      {/* Reopen is a secondary fact about a period whose headline state is now
                          "Reopened" — a muted sub-line under the badge, rather than folded into
                          one run-on sentence with everything else about the row. */}
                      {!closed && (
                        <div className="mt-0.5 text-meta font-normal text-muted-60">
                          by {p.reopenedBy}, {fmtDateTime(p.reopenedAt)}
                        </div>
                      )}
                    </div>
                    <div className={cn(PERIOD_COL.closedBy, 'truncate text-body font-normal text-muted-70')} title={p.closedBy}>
                      {p.closedBy}
                    </div>
                    <div className={cn(PERIOD_COL.closedAt, 'whitespace-nowrap text-meta font-normal text-muted-70')}>{fmtDateTime(p.closedAt)}</div>
                    <div className={cn(PERIOD_COL.margin, 'tabular text-body font-semibold', marginClass(p.closedMargin))}>{marginText(p.closedMargin)}</div>
                    <div className={PERIOD_COL.action}>
                      {closed && (
                        <Button type="button" variant="secondary" size="sm" disabled={periodBusy} onClick={() => doReopen(p.id)}>
                          <LockOpen size={13} strokeWidth={2.2} aria-hidden="true" />
                          Reopen
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
