import { useStore } from '@/lib/store'
import { fmt } from '@/lib/format'
import { CHEQUE_STATUS_STYLE } from '@/lib/ui-helpers'

export function Cheques() {
  const { state, isAdmin, depositCheque, clearCheque, returnCheque } = useStore()
  const inward = state.cheques.filter((q) => q.direction === 'Inward' && q.status !== 'Cleared' && q.status !== 'Returned')
  const outward = state.cheques.filter((q) => q.direction === 'Outward' && q.status !== 'Cleared' && q.status !== 'Returned')

  return (
    <div>
      <h1 className="m-0 mb-[3px] text-[17px] font-semibold">Cheques</h1>
      <div className="mb-3 text-[12px] text-muted-60">Inward and outward cheques and where they sit in their lifecycle. A cheque only moves a balance when it clears.</div>
      <div className="mb-3.5 grid grid-cols-2 gap-3">
        <div className="rounded-[8px] border border-border border-l-[3px] border-l-positive bg-surface px-3.5 py-2.5">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Inward uncleared</div>
          <div className="tabular text-[19px] font-medium tracking-tight text-positive">{fmt(inward.reduce((s, q) => s + q.amount, 0))}</div>
          <div className="mt-0.5 text-[10.5px] text-muted-60">{inward.length} — still counted in receivables</div>
        </div>
        <div className="rounded-[8px] border border-border border-l-[3px] border-l-border-strong bg-surface px-3.5 py-2.5">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Outward uncleared</div>
          <div className="tabular text-[19px] font-medium tracking-tight">{fmt(outward.reduce((s, q) => s + q.amount, 0))}</div>
          <div className="mt-0.5 text-[10.5px] text-muted-60">{outward.length} — still counted in payables</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[8px] border border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-[78px]">Direction</div>
          <div className="min-w-[86px]">Cheque no.</div>
          <div className="flex-1">Party</div>
          <div className="min-w-[96px]">Bank</div>
          <div className="min-w-[84px]">Status</div>
          <div className="min-w-[110px] text-right">Amount</div>
          <div className="min-w-[74px] text-right">Due</div>
        </div>
        {state.cheques.map((q) => {
          const style = CHEQUE_STATUS_STYLE[q.status]
          return (
            <div key={q.id} className="border-b border-divider px-[13px] py-2.5">
              <div className="flex items-center gap-2.5">
                <div className={`min-w-[78px] text-[12px] font-semibold ${q.direction === 'Inward' ? 'text-positive' : 'text-ink'}`}>{q.direction}</div>
                <div className="tabular min-w-[86px] text-[12px] text-muted-70">{q.number}</div>
                <div className="flex-1 text-[12.5px] font-semibold">{q.party}</div>
                <div className="min-w-[96px] text-[12px] text-muted-70">{q.bank}</div>
                <div className="min-w-[84px]">
                  <span className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: style.bg, color: style.color }}>
                    {q.status}
                  </span>
                </div>
                <div className="tabular min-w-[110px] text-right text-[12.5px] font-medium">{fmt(q.amount)}</div>
                <div className="min-w-[74px] text-right text-[11px] text-muted-60">{q.due}</div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <div className="min-w-[200px] flex-1 text-[10.5px] text-muted-60">{q.history.join(' → ')}</div>
                {q.status === 'Pending' && (
                  <button onClick={() => depositCheque(q.id)} className="rounded-[5px] border border-border-input bg-surface px-2.5 py-1 text-[11px] font-semibold hover:bg-surface-tint">
                    Mark deposited
                  </button>
                )}
                {q.status === 'Deposited' &&
                  (isAdmin ? (
                    <>
                      <button onClick={() => clearCheque(q.id)} className="rounded-[5px] border border-accent bg-accent px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-accent-hover">
                        Mark cleared
                      </button>
                      <button onClick={() => returnCheque(q.id)} className="rounded-[5px] border border-negative-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-negative-deep hover:bg-negative-bg">
                        Mark returned
                      </button>
                    </>
                  ) : (
                    <span className="flex items-center gap-1 whitespace-nowrap rounded-[5px] border border-dashed border-border-input bg-app px-2.5 py-1 text-[11px] font-semibold text-muted-38">Mark cleared — Admin</span>
                  ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
