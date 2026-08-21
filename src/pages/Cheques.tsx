import { Banknote } from 'lucide-react'
import { useStore } from '@/lib/store'
import { fmt } from '@/lib/format'
import { statusMeta } from '@/lib/ui-helpers'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'

export function Cheques() {
  const { state, isAdmin, depositCheque, clearCheque, returnCheque } = useStore()
  const inward = state.cheques.filter((q) => q.direction === 'Inward' && q.status !== 'Cleared' && q.status !== 'Returned')
  const outward = state.cheques.filter((q) => q.direction === 'Outward' && q.status !== 'Cleared' && q.status !== 'Returned')

  return (
    <div>
      <h1 className="m-0 mb-[3px] text-[17px] font-semibold">Cheques</h1>
      <div className="mb-3 text-[12px] font-normal text-muted-60">Inward and outward cheques and where they sit in their lifecycle. A cheque only moves a balance when it clears.</div>
      <div className="mb-3.5 grid grid-cols-2 gap-3">
        <Card className="border-l-[3px] border-l-positive px-3.5 py-2.5">
          <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-60">Inward uncleared</div>
          <div className="tabular text-[19px] font-semibold tracking-tight text-positive">{fmt(inward.reduce((s, q) => s + q.amount, 0))}</div>
          <div className="mt-0.5 text-[10.5px] font-normal text-muted-60">{inward.length} — still counted in receivables</div>
        </Card>
        <Card className="border-l-[3px] border-l-border-strong px-3.5 py-2.5">
          <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-60">Outward uncleared</div>
          <div className="tabular text-[19px] font-semibold tracking-tight">{fmt(outward.reduce((s, q) => s + q.amount, 0))}</div>
          <div className="mt-0.5 text-[10.5px] font-normal text-muted-60">{outward.length} — still counted in payables</div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-[78px]">Direction</div>
          <div className="min-w-[86px]">Cheque no.</div>
          <div className="flex-1">Party</div>
          <div className="min-w-[96px]">Bank</div>
          <div className="min-w-[100px]">Status</div>
          <div className="min-w-[110px] text-right">Amount</div>
          <div className="min-w-[74px] text-right">Due</div>
        </div>
        {state.cheques.map((q) => {
          const status = statusMeta(q.status)
          const StatusIcon = status.icon
          return (
            <div key={q.id} className="border-b border-divider px-[13px] py-2.5">
              <div className="flex items-center gap-2.5">
                <div className={`min-w-[78px] text-[12px] font-medium ${q.direction === 'Inward' ? 'text-positive' : 'text-ink'}`}>{q.direction}</div>
                <div className="tabular min-w-[86px] text-[12px] font-normal text-muted-70">{q.number}</div>
                <div className="flex-1 text-[12.5px] font-semibold">{q.party}</div>
                <div className="min-w-[96px] text-[12px] font-normal text-muted-70">{q.bank}</div>
                <div className="min-w-[100px]">
                  <Badge variant={status.variant}>
                    <StatusIcon size={10} strokeWidth={2.4} aria-hidden="true" />
                    {q.status}
                  </Badge>
                </div>
                <div className="tabular min-w-[110px] text-right text-[12.5px] font-medium">{fmt(q.amount)}</div>
                <div className="min-w-[74px] text-right text-[11px] font-normal text-muted-60">{q.due}</div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <div className="min-w-[200px] flex-1 text-[10.5px] font-normal text-muted-60">{q.history.join(' → ')}</div>
                {q.status === 'Pending' && (
                  <Button variant="secondary" size="sm" className="text-[11px]" onClick={() => depositCheque(q.id)}>
                    Mark deposited
                  </Button>
                )}
                {q.status === 'Deposited' &&
                  (isAdmin ? (
                    <>
                      <Button variant="primary" size="sm" className="text-[11px]" onClick={() => clearCheque(q.id)}>
                        Mark cleared
                      </Button>
                      <Button variant="outlineDestructive" size="sm" className="text-[11px]" onClick={() => returnCheque(q.id)}>
                        Mark returned
                      </Button>
                    </>
                  ) : (
                    <span className="flex items-center gap-1 whitespace-nowrap rounded-[6px] border border-dashed border-border-input bg-app px-2.5 py-1 text-[11px] font-semibold text-muted-38">Mark cleared — Admin</span>
                  ))}
              </div>
            </div>
          )
        })}
        {state.cheques.length === 0 && <EmptyState icon={Banknote} title="No cheques recorded yet" description="Cheques taken as settlement on a purchase, sale, or payment will show up here." />}
      </Card>
    </div>
  )
}
