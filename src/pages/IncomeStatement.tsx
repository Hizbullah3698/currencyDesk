import { useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { rangeBounds, isToday } from '@/lib/engine'
import { computeIncomeStatement } from '@/lib/reports'
import { fmt } from '@/lib/format'
import type { ReportPreset } from '@/lib/types'

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
    <div className="max-w-[720px]">
      <h1 className="m-0 mb-[3px] text-[17px] font-semibold">Income Statement</h1>
      <div className="mb-3 text-[12px] text-muted-60">Derived live from recorded sales margin and journal postings, for the period you select.</div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Period</span>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => pick(p.key)}
            className={`whitespace-nowrap rounded-[6px] px-2.5 py-1.5 text-[11.5px] font-semibold ${preset === p.key && !rangeActive ? 'border border-accent bg-accent-bg text-accent' : 'border border-border-input bg-surface text-ink'}`}
          >
            {p.label}
          </button>
        ))}
        <span className="h-5 w-px bg-border" />
        <input type="date" value={from} onChange={(e) => (setFrom(e.target.value), setPreset('custom'))} className="h-[30px] rounded-[6px] border border-border-input bg-surface px-2 text-[11.5px] text-ink" />
        <span className="text-[11.5px] text-muted-60">to</span>
        <input type="date" value={to} onChange={(e) => (setTo(e.target.value), setPreset('custom'))} className="h-[30px] rounded-[6px] border border-border-input bg-surface px-2 text-[11.5px] text-ink" />
        {rangeActive && (
          <button
            onClick={() => {
              setFrom('')
              setTo('')
              setPreset('all')
            }}
            className="rounded-[6px] border border-border-input bg-surface px-2.5 py-1.5 text-[11.5px] font-semibold text-muted-70"
          >
            Clear
          </button>
        )}
      </div>
      <div className="mb-3 text-[11.5px] text-muted-60">
        Showing {bounds.label}. Every line below — gross profit, expenses and due salaries — counts only entries dated inside it.
      </div>

      <div className="overflow-hidden rounded-[8px] border border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="flex-1">Line</div>
          <div className="min-w-[150px] text-right">Amount</div>
        </div>

        <div className={`flex items-center gap-2.5 border-b border-divider px-[13px] py-2.5 bg-[#fcfcfd]`}>
          <div className="flex-1">
            <div className="text-[12.5px] font-bold">Gross Profit / Loss</div>
            <div className="text-[11px] text-muted-60">Margin on currency sales plus journal postings to Income</div>
          </div>
          <div className={`tabular min-w-[150px] text-right text-[13.5px] font-bold ${result.gross >= 0 ? 'text-positive' : 'text-negative'}`}>{fmt(result.gross)}</div>
        </div>

        <div className="flex items-center gap-2.5 border-b border-divider py-2 pl-5 pr-[13px]">
          <div className="flex-1">
            <div className="text-[12px] font-semibold">Margin on currency sales</div>
            <div className="text-[11px] text-muted-60">{result.currencyRows.length} desk{result.currencyRows.length === 1 ? '' : 's'} with activity in this period</div>
          </div>
          <div className="tabular min-w-[150px] text-right text-[12.5px] font-semibold">{fmt(result.salesMargin)}</div>
        </div>

        {result.currencyRows.map((cur) => (
          <div key={cur.code} className="flex items-center gap-2.5 border-b border-divider py-2 pl-[26px] pr-[13px] bg-[#fcfcfd]">
            <div className="flex-1">
              <div className="text-[12px] font-semibold">{cur.code} desk</div>
              <div className="text-[11px] text-muted-60">{cur.sub}</div>
            </div>
            <div className={`tabular min-w-[150px] text-right text-[12.5px] font-semibold ${cur.margin >= 0 ? '' : 'text-negative'}`}>{fmt(cur.margin)}</div>
          </div>
        ))}

        {result.adjRows.length > 0 && (
          <>
            <div className="flex items-center gap-2.5 border-b border-divider py-2 pl-5 pr-[13px]">
              <div className="flex-1">
                <div className="text-[12px] font-semibold">Journal postings to Income</div>
                <div className="text-[11px] text-muted-60">{result.adjRows.length} entr{result.adjRows.length === 1 ? 'y' : 'ies'}</div>
              </div>
              <div className="tabular min-w-[150px] text-right text-[12.5px] font-semibold">{fmt(result.journalAdj)}</div>
            </div>
            {result.adjRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2.5 border-b border-divider py-1.5 pl-[26px] pr-[13px]">
                <div className="flex-1">
                  <div className="text-[12px]">{row.label}</div>
                  <div className="text-[11px] text-muted-60">{row.sub}</div>
                </div>
                <div className="tabular min-w-[150px] text-right text-[12px] text-muted-70">{fmt(row.amount)}</div>
              </div>
            ))}
          </>
        )}

        <div className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2.5 bg-[#fcfcfd]">
          <div className="flex-1">
            <div className="text-[12.5px] font-bold">Expenses</div>
            <div className="text-[11px] text-muted-60">{result.expenseRows.length} account{result.expenseRows.length === 1 ? '' : 's'} with postings in this period</div>
          </div>
          <div className="tabular min-w-[150px] text-right text-[13.5px] font-bold">{fmt(result.expenseTotal)}</div>
        </div>
        {result.expenseRows.map((row) => (
          <div key={row.id} className="flex items-center gap-2.5 border-b border-divider py-1.5 pl-[26px] pr-[13px]">
            <div className="flex-1">
              <div className="text-[12px]">{row.label}</div>
              <div className="text-[11px] text-muted-60">{row.sub}</div>
            </div>
            <div className="tabular min-w-[150px] text-right text-[12px] text-muted-70">{fmt(row.amount)}</div>
          </div>
        ))}

        <div className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2.5 bg-[#fcfcfd]">
          <div className="flex-1">
            <div className="text-[12.5px] font-bold">Due Salaries</div>
            <div className="text-[11px] text-muted-60">Accrued salary expense inside this period (included in Expenses above)</div>
          </div>
          <div className="tabular min-w-[150px] text-right text-[13.5px] font-bold">{fmt(result.salaryDue)}</div>
        </div>

        <div className="flex items-center gap-2.5 border-t-2 border-border-input bg-surface-hover px-[13px] py-2.5">
          <div className="flex-1">
            <div className="text-[12.5px] font-bold">Net Profit / Loss</div>
            <div className="text-[11px] text-muted-60">Gross profit less expenses (the salary accrual is inside Expenses)</div>
          </div>
          <div className={`tabular min-w-[150px] text-right text-[15px] font-bold ${result.net >= 0 ? 'text-positive' : 'text-negative'}`}>{fmt(result.net)}</div>
        </div>
      </div>

      {failed.length > 0 ? (
        <div className="mt-3 rounded-[6px] border border-negative-border border-l-[3px] border-l-negative bg-negative-bg px-3 py-2.5">
          <div className="mb-1 text-[12px] font-bold text-negative-deep">{failed.length} integrity check{failed.length === 1 ? '' : 's'} failed</div>
          {failed.map((c, i) => (
            <div key={i} className="mt-1.5">
              <div className="text-[11.5px] font-semibold text-negative-deep">{c.label}</div>
              <div className="text-[11px] leading-relaxed text-negative-deep">{c.detail}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted-60">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10794f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 block flex-none">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span>All {result.checks.length} integrity checks passed for this period — see below.</span>
        </div>
      )}

      <div className="mt-2 text-[11.5px] leading-relaxed text-muted-60">
        PKR and AED (and USD, where held) are never blended into one figure — each currency desk's margin is computed and shown separately above.
      </div>
      <div className="mt-2 text-[11.5px] leading-relaxed text-muted-60">
        Overview's "Margin today" shows {fmt(todayMargin)} — the same margin data filtered to today only, so it is a subset of Gross Profit above, not a different figure.
      </div>
    </div>
  )
}
