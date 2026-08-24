import { useMemo, useState } from 'react'
import { UserRound, Landmark, Coins, Users2, TrendingUp, Receipt, PiggyBank, Printer } from 'lucide-react'
import { useStore } from '@/lib/store'
import { rangeBounds } from '@/lib/engine'
import { computeBalanceSheet } from '@/lib/reports'
import { fmt } from '@/lib/format'
import type { ReportPreset } from '@/lib/types'
import { statusMeta, CATEGORY_COLORS, type Category } from '@/lib/ui-helpers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PrintHeader } from '@/components/PrintHeader'
import { cn } from '@/lib/utils'

const PRESETS: { key: ReportPreset; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'ytd', label: 'Year to date' },
]

// Maps each trial-balance group title (see GROUP_TITLES in lib/reports.ts) to the
// client-facing category it represents, so the section header gets the same soft
// icon-badge identity used on the Dashboard and sidebar. Groups with no clean match
// to a named category (Income, Expenses, Equity) stay neutral rather than guessing.
const GROUP_META: Record<string, { category: Category; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }> = {
  'Receivables & Payables — Customers': { category: 'customers', icon: UserRound },
  'Bank & Cash': { category: 'bank', icon: Landmark },
  'Currency Stock': { category: 'fx', icon: Coins },
  'Other Payables': { category: 'salary', icon: Users2 },
  Income: { category: 'neutral', icon: TrendingUp },
  Expenses: { category: 'neutral', icon: Receipt },
  Equity: { category: 'neutral', icon: PiggyBank },
}

export function BalanceSheet() {
  const { state } = useStore()
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
  const status = statusMeta(result.balanced ? 'Balanced' : 'Out of balance')
  const StatusIcon = status.icon

  return (
    <div>
      <PrintHeader title="Balance Sheet" period={`As of ${bounds.label}.`} />

      <div className="flex items-start justify-between gap-3 print:hidden">
        <h1 className="m-0 mb-[3px] text-[17px] font-semibold">Balance Sheet</h1>
        <div className="flex flex-none gap-2">
          <Button variant="secondary" size="sm" className="whitespace-nowrap text-[11.5px] font-medium" onClick={() => window.print()}>
            <Printer size={13} strokeWidth={2} aria-hidden="true" />
            Print
          </Button>
        </div>
      </div>
      <div className="mb-3 text-[12px] font-normal text-muted-60 print:hidden">
        Every balance below is derived live from accounts, stock, transactions, cheques and journal entries. Cheque-method amounts count only once cleared.
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-60">Period</span>
        {PRESETS.map((p) => (
          <Button
            key={p.key}
            type="button"
            variant="secondary"
            size="sm"
            aria-pressed={preset === p.key && !rangeActive}
            onClick={() => pick(p.key)}
            className={cn('text-[11.5px]', preset === p.key && !rangeActive && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
          >
            {p.label}
          </Button>
        ))}
        <span className="h-5 w-px bg-border" aria-hidden="true" />
        <Input type="date" value={from} onChange={(e) => (setFrom(e.target.value), setPreset('custom'))} className="h-[30px] w-auto text-[11.5px]" />
        <span className="text-[11.5px] font-normal text-muted-60">to</span>
        <Input type="date" value={to} onChange={(e) => (setTo(e.target.value), setPreset('custom'))} className="h-[30px] w-auto text-[11.5px]" />
        {rangeActive && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="text-[11.5px]"
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
      <div className="mb-3 text-[11.5px] font-normal text-muted-60 print:hidden">As of {bounds.label}.</div>

      <Card className="overflow-hidden print:border-0 print:shadow-none">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="flex-1">Account</div>
          <div className="min-w-[130px] text-right">Debit</div>
          <div className="min-w-[130px] text-right">Credit</div>
        </div>
        {result.groups.map((group) => {
          const meta = GROUP_META[group.title] || { category: 'neutral' as Category, icon: Landmark }
          const cat = CATEGORY_COLORS[meta.category]
          const GroupIcon = meta.icon
          return (
          <div key={group.title}>
            <div className="flex items-center gap-1.5 border-b border-border bg-surface-tint px-[13px] py-[7px] text-[11px] font-bold uppercase tracking-wide text-muted-70">
              <span className="flex h-[17px] w-[17px] flex-none items-center justify-center rounded-[4px]" style={{ background: cat.bg, color: cat.color }}>
                <GroupIcon size={10} strokeWidth={2.4} aria-hidden="true" />
              </span>
              {group.title}
            </div>
            {group.rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2">
                <div className="flex-1">
                  <div className="text-[12.5px] font-semibold">{row.label}</div>
                  <div className="text-[11px] font-normal text-muted-60">{row.sub}</div>
                </div>
                <div className="tabular min-w-[130px] text-right text-[12.5px] font-normal">{row.dr ? fmt(row.dr) : ''}</div>
                <div className="tabular min-w-[130px] text-right text-[12.5px] font-normal">{row.cr ? fmt(row.cr) : ''}</div>
              </div>
            ))}
            <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-1.5">
              <div className="flex-1 text-[11px] font-normal text-muted-60">Subtotal</div>
              <div className="tabular min-w-[130px] text-right text-[12px] font-semibold">{fmt(group.subDr)}</div>
              <div className="tabular min-w-[130px] text-right text-[12px] font-semibold">{fmt(group.subCr)}</div>
            </div>
          </div>
          )
        })}
        <div className="flex items-center gap-2.5 border-t-2 border-border-input bg-surface-hover px-[13px] py-2.5">
          <div className="flex-1 text-[12.5px] font-bold">Total</div>
          <div className="tabular min-w-[130px] text-right text-[13.5px] font-bold">{fmt(result.totalDr)}</div>
          <div className="tabular min-w-[130px] text-right text-[13.5px] font-bold">{fmt(result.totalCr)}</div>
        </div>
      </Card>

      <div className={`mt-3 flex items-center gap-2.5 rounded-[8px] border px-[13px] py-2.5 ${result.balanced ? 'border-positive-border bg-positive-bg' : 'border-negative-border bg-negative-bg'}`}>
        <Badge variant={status.variant} className="bg-white">
          <StatusIcon size={10} strokeWidth={2.4} aria-hidden="true" />
          {result.balanced ? 'Balanced' : 'Out of balance'}
        </Badge>
        <span className={`text-[12px] font-normal ${result.balanced ? 'text-positive' : 'text-negative'}`}>
          {result.balanced ? 'Debits and credits agree across the full dataset.' : `Debits and credits differ by ${fmt(Math.abs(result.totalDr - result.totalCr))}.`}
        </span>
      </div>

      {result.diags.length > 0 && (
        <Card className="mt-3 overflow-hidden">
          <div className="border-b border-border px-[13px] py-2.5 text-[12.5px] font-semibold">Reconciliation — what the equity plug absorbed</div>
          {result.diags.map((d, i) => (
            <div key={i} className="flex items-start gap-3 border-b border-divider px-[13px] py-2.5">
              <div className="flex-1">
                <div className="text-[12.5px] font-semibold">{d.label}</div>
                <div className="text-[11.5px] font-normal leading-relaxed text-muted-70">{d.detail}</div>
              </div>
              <div className="tabular min-w-[120px] text-right text-[12.5px] font-semibold">{fmt(d.amount)}</div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
