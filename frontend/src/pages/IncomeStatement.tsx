import { useMemo, useState } from 'react'
import { CheckCircle2, AlertTriangle, Printer, TrendingUp, TrendingDown } from 'lucide-react'
import { useStore } from '@/lib/store'
import { rangeBounds, isToday } from '@/lib/engine'
import { computeIncomeStatement } from '@/lib/reports'
import { fmt } from '@/lib/format'
import type { ReportPreset } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Card } from '@/components/ui/card'
import { SignedAmount } from '@/components/ui/signed-amount'
import { PrintHeader } from '@/components/PrintHeader'
import { cn } from '@/lib/utils'

const PRESETS: { key: ReportPreset; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'ytd', label: 'Year to date' },
]

export function IncomeStatement() {
  const { state } = useStore()
  const [preset, setPreset] = useState<ReportPreset>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const bounds = useMemo(() => rangeBounds(preset === 'custom' ? (from || to ? 'custom' : 'all') : preset, from, to), [preset, from, to])
  const result = useMemo(
    () => computeIncomeStatement(state.accounts, state.activity, state.journalEntries, state.stocks, bounds.fromT, bounds.toT),
    [state.accounts, state.activity, state.journalEntries, state.stocks, bounds.fromT, bounds.toT],
  )

  const todayMargin = useMemo(
    () => state.activity.filter((t) => t.type === 'sale' && isToday(t.createdAt)).reduce((s, t) => s + (t.margin || 0), 0),
    [state.activity],
  )

  function pick(key: ReportPreset) {
    setPreset(key)
    if (key !== 'custom') {
      setFrom('')
      setTo('')
    }
  }

  const rangeActive = !!(from || to)
  const failed = result.checks.filter((c) => !c.ok)

  return (
    <div className="max-w-[720px] print:max-w-none">
      <PrintHeader title="Income Statement" period={`Showing ${bounds.label}.`} />

      <div className="flex items-start justify-between gap-3 print:hidden">
        <h1 className="m-0 mb-[3px] font-serif text-report font-normal tracking-tight">Income Statement</h1>
        <Button variant="secondary" size="sm" className="whitespace-nowrap text-meta font-medium" onClick={() => window.print()}>
          <Printer size={13} strokeWidth={2} aria-hidden="true" />
          Print
        </Button>
      </div>
      <div className="mb-3 text-body font-normal text-muted-60 print:hidden">Derived live from recorded sales margin and journal postings, for the period you select.</div>

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
              setPreset('all')
            }}
          >
            Clear
          </Button>
        )}
      </div>
      <div className="mb-3 text-meta font-normal text-muted-60 print:hidden">
        Showing {bounds.label}. Every line below — gross profit, expenses and due salaries — counts only entries dated inside it.
      </div>

      <Card className="overflow-hidden print:border-0 print:shadow-none">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
          <div className="flex-1">Line</div>
          <div className="min-w-[150px] text-right">Amount</div>
        </div>

        <div className={cn('flex items-center gap-2.5 border-b border-divider px-[13px] py-2.5', result.gross >= 0 ? 'bg-positive-bg' : 'bg-negative-bg')}>
          <div className="flex-1">
            <div className="text-body font-bold">Gross Profit / Loss</div>
            <div className="text-meta font-normal text-muted-60">Margin on currency sales plus journal postings to Income</div>
          </div>
          <div className={cn('tabular flex min-w-[150px] items-center justify-end gap-1 text-body font-bold', result.gross >= 0 ? 'text-positive-text' : 'text-negative-deep')}>
            {result.gross >= 0 ? <TrendingUp size={13} strokeWidth={2.6} aria-hidden="true" /> : <TrendingDown size={13} strokeWidth={2.6} aria-hidden="true" />}
            {result.gross >= 0 ? '+' : '−'}
            {fmt(Math.abs(result.gross))}
          </div>
        </div>

        <div className="flex items-center gap-2.5 border-b border-divider py-2 pl-5 pr-[13px]">
          <div className="flex-1">
            <div className="text-body font-semibold">Margin on currency sales</div>
            <div className="text-meta font-normal text-muted-60">{result.currencyRows.length} desk{result.currencyRows.length === 1 ? '' : 's'} with activity in this period</div>
          </div>
          <div className="tabular min-w-[150px] text-right text-body font-semibold">{fmt(result.salesMargin)}</div>
        </div>

        {result.currencyRows.map((cur) => (
          <div key={cur.code} className="flex items-center gap-2.5 border-b border-divider bg-surface-sunken py-2 pl-[26px] pr-[13px] transition-colors duration-150 hover:bg-surface-hover">
            <div className="flex-1">
              <div className="text-body font-medium">{cur.code} desk</div>
              <div className="text-meta font-normal text-muted-60">{cur.sub}</div>
            </div>
            <div className="flex min-w-[150px] justify-end">
              <SignedAmount value={cur.margin} />
            </div>
          </div>
        ))}

        {result.adjRows.length > 0 && (
          <>
            <div className="flex items-center gap-2.5 border-b border-divider py-2 pl-5 pr-[13px]">
              <div className="flex-1">
                <div className="text-body font-semibold">Journal postings to Income</div>
                <div className="text-meta font-normal text-muted-60">{result.adjRows.length} entr{result.adjRows.length === 1 ? 'y' : 'ies'}</div>
              </div>
              <div className="tabular min-w-[150px] text-right text-body font-semibold">{fmt(result.journalAdj)}</div>
            </div>
            {result.adjRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2.5 border-b border-divider py-1.5 pl-[26px] pr-[13px] transition-colors duration-150 hover:bg-surface-hover">
                <div className="flex-1">
                  <div className="text-body font-normal">{row.label}</div>
                  <div className="text-meta font-normal text-muted-60">{row.sub}</div>
                </div>
                <div className="tabular min-w-[150px] text-right text-body font-normal text-muted-70">{fmt(row.amount)}</div>
              </div>
            ))}
          </>
        )}

        <div className="flex items-center gap-2.5 border-b border-divider bg-surface-sunken px-[13px] py-2.5">
          <div className="flex-1">
            <div className="text-body font-bold">Expenses</div>
            <div className="text-meta font-normal text-muted-60">{result.expenseRows.length} account{result.expenseRows.length === 1 ? '' : 's'} with postings in this period</div>
          </div>
          <div className="tabular min-w-[150px] text-right text-body font-bold">{fmt(result.expenseTotal)}</div>
        </div>
        {result.expenseRows.map((row) => (
          <div key={row.id} className="flex items-center gap-2.5 border-b border-divider py-1.5 pl-[26px] pr-[13px] transition-colors duration-150 hover:bg-surface-hover">
            <div className="flex-1">
              <div className="text-body font-normal">{row.label}</div>
              <div className="text-meta font-normal text-muted-60">{row.sub}</div>
            </div>
            <div className="tabular min-w-[150px] text-right text-body font-normal text-muted-70">{fmt(row.amount)}</div>
          </div>
        ))}

        <div className="flex items-center gap-2.5 border-b border-divider bg-surface-sunken px-[13px] py-2.5">
          <div className="flex-1">
            <div className="text-body font-bold">Due Salaries</div>
            <div className="text-meta font-normal text-muted-60">Accrued salary expense inside this period (included in Expenses above)</div>
          </div>
          <div className="tabular min-w-[150px] text-right text-body font-bold">{fmt(result.salaryDue)}</div>
        </div>

        <div className={cn('flex items-center gap-2.5 border-t-2 border-border-input px-[13px] py-2.5', result.net >= 0 ? 'bg-positive-bg' : 'bg-negative-bg')}>
          <div className="flex-1">
            <div className="text-body font-bold">Net Profit / Loss</div>
            <div className="text-meta font-normal text-muted-60">Gross profit less expenses (the salary accrual is inside Expenses)</div>
          </div>
          <div className={cn('tabular flex min-w-[150px] items-center justify-end gap-1.5 text-hero font-bold', result.net >= 0 ? 'text-positive-text' : 'text-negative-deep')}>
            {result.net >= 0 ? <TrendingUp size={20} strokeWidth={2.4} aria-hidden="true" /> : <TrendingDown size={20} strokeWidth={2.4} aria-hidden="true" />}
            {result.net >= 0 ? '+' : '−'}
            {fmt(Math.abs(result.net))}
          </div>
        </div>
      </Card>

      {failed.length > 0 ? (
        <div className="mt-3 rounded-control border border-negative-border border-l-[3px] border-l-negative bg-negative-bg px-3 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-body font-bold text-negative-deep">
            <AlertTriangle size={13} strokeWidth={2.4} aria-hidden="true" />
            {failed.length} integrity check{failed.length === 1 ? '' : 's'} failed
          </div>
          {failed.map((c, i) => (
            <div key={i} className="mt-1.5">
              <div className="text-meta font-semibold text-negative-deep">{c.label}</div>
              <div className="text-meta font-normal leading-relaxed text-negative-deep">{c.detail}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-1.5 text-meta font-normal leading-relaxed text-muted-60">
          <CheckCircle2 size={13} strokeWidth={2.4} className="mt-0.5 block flex-none text-positive" aria-hidden="true" />
          <span>All {result.checks.length} integrity checks passed for this period — see below.</span>
        </div>
      )}

      <div className="mt-2 text-meta font-normal leading-relaxed text-muted-60">
        PKR and AED are never blended into one figure — each currency desk's margin is computed and shown separately above.
      </div>
      <div className="mt-2 text-meta font-normal leading-relaxed text-muted-60">
        Overview's "Margin today" shows {fmt(todayMargin)} — the same margin data filtered to today only, so it is a subset of Gross Profit above, not a different figure.
      </div>
    </div>
  )
}
