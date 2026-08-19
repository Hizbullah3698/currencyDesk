import { useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { rangeBounds } from '@/lib/engine'
import { computeBalanceSheet } from '@/lib/reports'
import { fmt } from '@/lib/format'
import type { ReportPreset } from '@/lib/types'

const PRESETS: { key: ReportPreset; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'ytd', label: 'Year to date' },
]

export function BalanceSheet() {
  const { state, resetDemoData } = useStore()
  const [preset, setPreset] = useState<ReportPreset>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const bounds = useMemo(() => rangeBounds(preset === 'custom' ? (from || to ? 'custom' : 'all') : preset, from, to), [preset, from, to])
  const result = useMemo(
    () => computeBalanceSheet(state.accounts, state.activity, state.cheques, state.journalEntries, state.stocks, bounds.toT),
    [state.accounts, state.activity, state.cheques, state.journalEntries, state.stocks, bounds.toT],
  )

  function pick(key: ReportPreset) {
    setPreset(key)
    if (key !== 'custom') {
      setFrom('')
      setTo('')
    }
  }

  const rangeActive = !!(from || to)

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <h1 className="m-0 mb-[3px] text-[17px] font-semibold">Balance Sheet</h1>
        <button onClick={resetDemoData} className="whitespace-nowrap rounded-[6px] border border-border-input bg-surface px-2.5 py-1.5 text-[11.5px] text-muted-70 transition-colors hover:bg-surface-tint hover:text-ink">
          Reset demo data
        </button>
      </div>
      <div className="mb-3 text-[12px] text-muted-60">
        Every balance below is derived live from accounts, stock, transactions, cheques and journal entries. Cheque-method amounts count only once cleared.
      </div>

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
      <div className="mb-3 text-[11.5px] text-muted-60">As of {bounds.label}.</div>

      <div className="overflow-hidden rounded-[8px] border border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="flex-1">Account</div>
          <div className="min-w-[130px] text-right">Debit</div>
          <div className="min-w-[130px] text-right">Credit</div>
        </div>
        {result.groups.map((group) => (
          <div key={group.title}>
            <div className="border-b border-border bg-[#f4f6f8] px-[13px] py-[7px] text-[11px] font-bold uppercase tracking-wide text-muted-70">{group.title}</div>
            {group.rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2">
                <div className="flex-1">
                  <div className="text-[12.5px] font-semibold">{row.label}</div>
                  <div className="text-[11px] text-muted-60">{row.sub}</div>
                </div>
                <div className="tabular min-w-[130px] text-right text-[12.5px]">{row.dr ? fmt(row.dr) : ''}</div>
                <div className="tabular min-w-[130px] text-right text-[12.5px]">{row.cr ? fmt(row.cr) : ''}</div>
              </div>
            ))}
            <div className="flex items-center gap-2.5 border-b border-border bg-[#fcfcfd] px-[13px] py-1.5">
              <div className="flex-1 text-[11px] text-muted-60">Subtotal</div>
              <div className="tabular min-w-[130px] text-right text-[12px] font-semibold">{fmt(group.subDr)}</div>
              <div className="tabular min-w-[130px] text-right text-[12px] font-semibold">{fmt(group.subCr)}</div>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2.5 border-t-2 border-border-input bg-surface-hover px-[13px] py-2.5">
          <div className="flex-1 text-[12.5px] font-bold">Total</div>
          <div className="tabular min-w-[130px] text-right text-[13.5px] font-bold">{fmt(result.totalDr)}</div>
          <div className="tabular min-w-[130px] text-right text-[13.5px] font-bold">{fmt(result.totalCr)}</div>
        </div>
      </div>

      <div className={`mt-3 flex items-center gap-2.5 rounded-[8px] border px-[13px] py-2.5 ${result.balanced ? 'border-positive-border bg-positive-bg' : 'border-negative-border bg-negative-bg'}`}>
        <span className={`rounded-[4px] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${result.balanced ? 'bg-white text-positive' : 'bg-white text-negative'}`}>
          {result.balanced ? 'Balanced' : 'Out of balance'}
        </span>
        <span className={`text-[12px] ${result.balanced ? 'text-positive' : 'text-negative'}`}>
          {result.balanced ? 'Debits and credits agree across the full dataset.' : `Debits and credits differ by ${fmt(Math.abs(result.totalDr - result.totalCr))}.`}
        </span>
      </div>

      {result.diags.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-[8px] border border-border bg-surface">
          <div className="border-b border-border px-[13px] py-2.5 text-[12.5px] font-semibold">Reconciliation — what the equity plug absorbed</div>
          {result.diags.map((d, i) => (
            <div key={i} className="flex items-start gap-3 border-b border-divider px-[13px] py-2.5">
              <div className="flex-1">
                <div className="text-[12.5px] font-semibold">{d.label}</div>
                <div className="text-[11.5px] leading-relaxed text-muted-70">{d.detail}</div>
              </div>
              <div className="tabular min-w-[120px] text-right text-[12.5px] font-semibold">{fmt(d.amount)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
