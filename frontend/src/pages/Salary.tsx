import { useMemo, useState } from 'react'
import { SquarePen, CheckCircle2, Users2, Receipt, Banknote, WalletCards } from 'lucide-react'
import { useStore } from '@/lib/store'
import { auditLine } from '@/lib/engine'
import { fmt } from '@/lib/format'
import { statusMeta } from '@/lib/ui-helpers'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { KpiCard } from '@/components/ui/kpi-card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

function periodLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function lastPeriods(count: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    out.push(periodLabel(new Date(now.getFullYear(), now.getMonth() - i, 1)))
  }
  return out
}

export function Salary() {
  const { state, isAdmin, employees, accrueSalary, accrueAllSalaries, paySalary, payAllSalaries, salaryStats } = useStore()
  const periods = useMemo(() => lastPeriods(6), [])
  const [period, setPeriod] = useState(periods[0])
  const banks = state.accounts.filter((a) => a.type === 'Bank' || a.type === 'Cash')
  const [bankId, setBankId] = useState(banks[0]?.id || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const emps = employees()
  const stats = emps.map((e) => ({ emp: e, stats: salaryStats(e.id) }))
  const totalOutstanding = stats.reduce((s, x) => s + x.stats.outstanding, 0)
  const totalAccrued = stats.reduce((s, x) => s + x.stats.accrued, 0)

  const postings = state.journalEntries.filter((e) => e.salary)

  async function run(fn: () => Promise<string>) {
    setBusy(true)
    const err = await fn()
    setBusy(false)
    setError(err)
  }

  return (
    <div>
      <div className="mb-[26px]">
        <h1 className="m-0 mb-1 text-heading font-semibold tracking-tight">Salary</h1>
        <div className="text-body font-normal text-muted-70">Accrual posts Dr Salary Expense / Cr Salary Payable. Payment posts Dr Salary Payable / Cr the account you pick.</div>
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-5">
        <div>
          <div className="mb-1.5 text-meta font-medium uppercase tracking-wide text-muted-60">Pay period</div>
          <div className="flex flex-wrap gap-1.5">
            {periods.map((p) => (
              <Button
                key={p}
                type="button"
                variant="secondary"
                size="sm"
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
                className={cn('text-meta', period === p && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
              >
                {p}
              </Button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-meta font-medium uppercase tracking-wide text-muted-60">Pay salaries from</div>
          <div className="flex flex-wrap gap-1.5">
            {banks.map((b) => (
              <Button
                key={b.id}
                type="button"
                variant="secondary"
                size="sm"
                aria-pressed={bankId === b.id}
                onClick={() => setBankId(b.id)}
                className={cn('text-meta', bankId === b.id && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
              >
                {b.name}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-5">
        <KpiCard tone="negative" icon={Banknote} label="Accrued but unpaid">
          <div className="tabular text-hero-lg font-semibold tracking-tight text-white">{fmt(totalOutstanding)}</div>
          <div className="mt-2 text-meta font-normal text-white/75">Salary Payable balance</div>
        </KpiCard>
        <KpiCard tone="accent" icon={WalletCards} label="Accrued to date">
          <div className="tabular text-hero-lg font-semibold tracking-tight text-white">{fmt(totalAccrued)}</div>
          <div className="mt-2 text-meta font-normal text-white/75">{emps.length} employee{emps.length === 1 ? '' : 's'} on file</div>
        </KpiCard>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <Button variant="primary" disabled={!isAdmin || busy} onClick={() => run(() => accrueAllSalaries(period))}>
          <SquarePen size={14} strokeWidth={2} aria-hidden="true" />
          {busy ? 'Working…' : `Accrue ${period} for all`}
        </Button>
        <Button variant="secondary" disabled={!isAdmin || busy} onClick={() => run(() => payAllSalaries(bankId))}>
          <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />
          {busy ? 'Working…' : `Pay everything outstanding from ${banks.find((b) => b.id === bankId)?.name || '—'}`}
        </Button>
      </div>
      {error && <div className="mb-3 text-body font-semibold text-negative-deep">{error}</div>}

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-0 flex-1">Employee</div>
          <div className="min-w-[96px]">This period</div>
          <div className="min-w-[120px] text-right">Monthly</div>
          <div className="min-w-[120px] text-right">Unpaid</div>
          <div className="min-w-[168px] text-right">Actions</div>
        </div>
        {stats.map(({ emp, stats: s }) => {
          const accruedThisPeriod = s.periods.includes(period)
          const status = statusMeta(accruedThisPeriod ? 'Accrued' : 'Not accrued')
          const StatusIcon = status.icon
          return (
            <div key={emp.id} className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2.5 transition-colors duration-150 hover:bg-surface-hover">
              <div className="min-w-0 flex-1">
                <div className="text-body font-semibold">{emp.name}</div>
                <div className="flex items-center gap-1.5">
                  <span className="text-meta font-normal text-muted-70">{emp.designation}</span>
                  <span className="cursor-help rounded-[5px] p-1.5 text-muted-38 transition-colors duration-150 hover:bg-surface-tint hover:text-accent" title={auditLine(emp)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="block" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                  </span>
                </div>
              </div>
              <div className="min-w-[96px]">
                <Badge variant={status.variant}>
                  <StatusIcon size={10} strokeWidth={2.4} aria-hidden="true" />
                  {accruedThisPeriod ? 'Accrued' : 'Not accrued'}
                </Badge>
              </div>
              <div className="tabular min-w-[120px] text-right text-body font-normal text-muted-70">{fmt(emp.monthlySalary || 0)}</div>
              <div className={`tabular min-w-[120px] text-right text-body font-medium ${s.outstanding > 0 ? 'text-negative-deep' : ''}`}>{fmt(s.outstanding)}</div>
              <div className="flex min-w-[168px] justify-end gap-1.5">
                <Button variant="secondary" size="sm" className="text-meta" disabled={!isAdmin || busy || accruedThisPeriod} onClick={() => run(() => accrueSalary(emp.id, period))}>
                  Accrue
                </Button>
                <Button variant="primary" size="sm" className="text-meta" disabled={!isAdmin || busy || s.outstanding <= 0} onClick={() => run(() => paySalary(emp.id, bankId))}>
                  Mark paid
                </Button>
              </div>
            </div>
          )
        })}
        {emps.length === 0 && <EmptyState icon={Users2} title="No employee accounts yet" description="Add one from Accounts with type Employee and a monthly salary." />}
      </Card>

      <Card className="mt-5 overflow-hidden">
        <div className="border-b border-border px-[13px] py-2.5 text-body font-semibold">Salary postings</div>
        {postings.map((row) => (
          <div key={row.id} className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2.5 transition-colors duration-150 hover:bg-surface-hover">
            <div className="tabular min-w-[64px] text-meta font-normal text-muted-60">{row.ref}</div>
            <div className="min-w-[78px]">
              <Badge variant={row.salary?.kind === 'accrual' ? 'pending' : 'positive'}>{row.salary?.kind === 'accrual' ? 'Accrual' : 'Payment'}</Badge>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-body font-medium">{row.narration}</div>
              <div className="text-meta font-normal text-muted-70">
                Dr {row.debitLabel} · Cr {row.creditLabel}
              </div>
              <div className="mt-0.5 text-meta font-normal text-muted-60">
                Posted by {row.createdBy} on {new Date(row.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            </div>
            <div className="tabular min-w-[130px] text-right text-body font-medium">{fmt(row.amount)}</div>
          </div>
        ))}
        {postings.length === 0 && <EmptyState icon={Receipt} title="Nothing posted yet" description="Accruing a period writes real journal entries you can see in the Journal and on the Balance Sheet." />}
      </Card>
    </div>
  )
}
