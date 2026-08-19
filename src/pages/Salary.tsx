import { useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { auditLine } from '@/lib/engine'
import { fmt } from '@/lib/format'

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

  const emps = employees()
  const stats = emps.map((e) => ({ emp: e, stats: salaryStats(e.id) }))
  const totalOutstanding = stats.reduce((s, x) => s + x.stats.outstanding, 0)
  const totalAccrued = stats.reduce((s, x) => s + x.stats.accrued, 0)

  const postings = state.journalEntries.filter((e) => e.salary)

  function run(fn: () => string) {
    const err = fn()
    setError(err)
  }

  return (
    <div>
      <div className="mb-[18px]">
        <h1 className="m-0 mb-1 text-[22px] font-semibold tracking-tight">Salary</h1>
        <div className="text-[12px] text-muted-70">Accrual posts Dr Salary Expense / Cr Salary Payable. Payment posts Dr Salary Payable / Cr the account you pick.</div>
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-5">
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Pay period</div>
          <div className="flex flex-wrap gap-1.5">
            {periods.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`whitespace-nowrap rounded-[6px] px-2.5 py-1.5 text-[11.5px] font-semibold ${period === p ? 'border border-accent bg-accent-bg text-accent' : 'border border-border-input bg-surface text-ink'}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Pay salaries from</div>
          <div className="flex flex-wrap gap-1.5">
            {banks.map((b) => (
              <button
                key={b.id}
                onClick={() => setBankId(b.id)}
                className={`whitespace-nowrap rounded-[6px] px-2.5 py-1.5 text-[11.5px] font-semibold ${bankId === b.id ? 'border border-accent bg-accent-bg text-accent' : 'border border-border-input bg-surface text-ink'}`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3">
        <div className="rounded-[8px] border border-border bg-surface px-[15px] py-[13px]">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Accrued but unpaid</div>
          <div className="tabular text-[24px] font-medium tracking-tight text-negative-deep">{fmt(totalOutstanding)}</div>
          <div className="mt-0.5 text-[11px] text-muted-60">Salary Payable balance</div>
        </div>
        <div className="rounded-[8px] border border-border bg-surface px-[15px] py-[13px]">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Accrued to date</div>
          <div className="tabular text-[24px] font-medium tracking-tight">{fmt(totalAccrued)}</div>
          <div className="mt-0.5 text-[11px] text-muted-60">{emps.length} employee{emps.length === 1 ? '' : 's'} on file</div>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <button
          disabled={!isAdmin}
          onClick={() => run(() => accrueAllSalaries(period))}
          className="rounded-[6px] border border-accent bg-accent px-3 py-[7px] text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:border-border-input disabled:bg-surface disabled:text-muted-60"
        >
          Accrue {period} for all
        </button>
        <button
          disabled={!isAdmin}
          onClick={() => run(() => payAllSalaries(bankId))}
          className="rounded-[6px] border border-border-input bg-surface px-3 py-[7px] text-[12.5px] font-semibold text-ink transition-colors hover:bg-surface-tint disabled:cursor-not-allowed disabled:text-muted-60"
        >
          Pay everything outstanding from {banks.find((b) => b.id === bankId)?.name || '—'}
        </button>
      </div>
      {error && <div className="mb-3 text-[12px] font-semibold text-negative-deep">{error}</div>}

      <div className="overflow-hidden rounded-[8px] border border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-0 flex-1">Employee</div>
          <div className="min-w-[96px]">This period</div>
          <div className="min-w-[120px] text-right">Monthly</div>
          <div className="min-w-[120px] text-right">Unpaid</div>
          <div className="min-w-[168px] text-right">Actions</div>
        </div>
        {stats.map(({ emp, stats: s }) => {
          const accruedThisPeriod = s.periods.includes(period)
          return (
            <div key={emp.id} className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold">{emp.name}</div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-70">{emp.designation}</span>
                  <span className="cursor-help rounded-[5px] p-1.5 text-muted-38 hover:bg-surface-tint hover:text-accent" title={auditLine(emp)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="block">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                  </span>
                </div>
              </div>
              <div className="min-w-[96px]">
                <span className={`rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${accruedThisPeriod ? 'bg-positive-bg text-positive' : 'bg-pending-bg text-pending'}`}>
                  {accruedThisPeriod ? 'Accrued' : 'Not accrued'}
                </span>
              </div>
              <div className="tabular min-w-[120px] text-right text-[12.5px] text-muted-70">{fmt(emp.monthlySalary || 0)}</div>
              <div className={`tabular min-w-[120px] text-right text-[12.5px] font-medium ${s.outstanding > 0 ? 'text-negative-deep' : ''}`}>{fmt(s.outstanding)}</div>
              <div className="flex min-w-[168px] justify-end gap-1.5">
                <button
                  disabled={!isAdmin || accruedThisPeriod}
                  onClick={() => run(() => accrueSalary(emp.id, period))}
                  className="rounded-[6px] border border-border-input bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-ink transition-colors hover:bg-surface-tint disabled:cursor-not-allowed disabled:text-muted-42"
                >
                  Accrue
                </button>
                <button
                  disabled={!isAdmin || s.outstanding <= 0}
                  onClick={() => run(() => paySalary(emp.id, bankId))}
                  className="rounded-[6px] border border-accent bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:border-border-input disabled:bg-surface disabled:text-muted-42"
                >
                  Mark paid
                </button>
              </div>
            </div>
          )
        })}
        {emps.length === 0 && (
          <div className="px-5 py-10 text-center">
            <div className="mb-1 text-[12.5px] font-semibold">No employee accounts yet</div>
            <div className="text-[12px] text-muted-60">Add one from Accounts with type Employee and a monthly salary.</div>
          </div>
        )}
      </div>

      <div className="mt-5 overflow-hidden rounded-[8px] border border-border bg-surface">
        <div className="border-b border-border px-[13px] py-2.5 text-[12.5px] font-semibold">Salary postings</div>
        {postings.map((row) => (
          <div key={row.id} className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2.5">
            <div className="tabular min-w-[64px] text-[11.5px] text-muted-60">{row.ref}</div>
            <div className="min-w-[78px]">
              <span className={`rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${row.salary?.kind === 'accrual' ? 'bg-pending-bg text-pending' : 'bg-positive-bg text-positive'}`}>
                {row.salary?.kind === 'accrual' ? 'Accrual' : 'Payment'}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold">{row.narration}</div>
              <div className="text-[11px] text-muted-70">
                Dr {row.debitLabel} · Cr {row.creditLabel}
              </div>
              <div className="mt-0.5 text-[10.5px] text-muted-60">
                Posted by {row.createdBy} on {new Date(row.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            </div>
            <div className="tabular min-w-[130px] text-right text-[12.5px] font-medium">{fmt(row.amount)}</div>
          </div>
        ))}
        {postings.length === 0 && (
          <div className="px-5 py-[30px] text-center text-[12px] text-muted-60">Nothing posted yet. Accruing a period writes real journal entries you can see in the Journal and on the Balance Sheet.</div>
        )}
      </div>
    </div>
  )
}
