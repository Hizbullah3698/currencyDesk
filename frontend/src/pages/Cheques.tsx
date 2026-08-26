import { useState } from 'react'
import { Banknote, Lock } from 'lucide-react'
import { useStore } from '@/lib/store'
import { fmt, fmtShortDate } from '@/lib/format'
import { statusMeta } from '@/lib/ui-helpers'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function Cheques() {
  const { state, isAdmin, depositCheque, clearCheque, returnCheque } = useStore()
  const inward = state.cheques.filter((q) => q.direction === 'Inward' && q.status !== 'Cleared' && q.status !== 'Returned')
  const outward = state.cheques.filter((q) => q.direction === 'Outward' && q.status !== 'Cleared' && q.status !== 'Returned')

  // Per-cheque pending/error state — this page previously had no error UI at all, since the old
  // client-side actions couldn't fail. A guarded status transition or a network error now can,
  // so each row tracks its own in-flight/error state independently of the others.
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function run(id: string, action: (id: string) => Promise<string>) {
    setPendingId(id)
    setErrors((e) => ({ ...e, [id]: '' }))
    const err = await action(id)
    setPendingId(null)
    if (err) setErrors((e) => ({ ...e, [id]: err }))
  }

  return (
    <div>
      <h1 className="m-0 mb-[3px] text-heading font-semibold">Cheques</h1>
      <div className="mb-[26px] text-body font-normal text-muted-60">Inward and outward cheques and where they sit in their lifecycle. A cheque only moves a balance when it clears.</div>
      <div className="mb-5 grid grid-cols-2 gap-5">
        <Card variant="flat" className="border-l-[3px] border-l-positive px-3.5 py-2.5">
          <div className="mb-1 text-meta font-medium uppercase tracking-wide text-muted-60">Inward uncleared</div>
          <div className="tabular text-hero font-semibold tracking-tight text-positive">{fmt(inward.reduce((s, q) => s + q.amount, 0))}</div>
          <div className="mt-0.5 text-meta font-normal text-muted-60">{inward.length} — still counted in receivables</div>
        </Card>
        <Card variant="flat" className="border-l-[3px] border-l-border-strong px-3.5 py-2.5">
          <div className="mb-1 text-meta font-medium uppercase tracking-wide text-muted-60">Outward uncleared</div>
          <div className="tabular text-hero font-semibold tracking-tight">{fmt(outward.reduce((s, q) => s + q.amount, 0))}</div>
          <div className="mt-0.5 text-meta font-normal text-muted-60">{outward.length} — still counted in payables</div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
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
          const busy = pendingId === q.id
          return (
            <div key={q.id} className="border-b border-divider px-[13px] py-2.5 transition-colors duration-150 hover:bg-surface-hover">
              <div className="flex items-center gap-2.5">
                <div className={`min-w-[78px] text-body font-medium ${q.direction === 'Inward' ? 'text-positive' : 'text-ink'}`}>{q.direction}</div>
                <div className="tabular min-w-[86px] text-body font-normal text-muted-70">{q.number}</div>
                <div className="flex-1 text-body font-semibold">{q.party}</div>
                <div className="min-w-[96px] text-body font-normal text-muted-70">{q.bank}</div>
                <div className="min-w-[100px]">
                  <Badge variant={status.variant}>
                    <StatusIcon size={10} strokeWidth={2.4} aria-hidden="true" />
                    {q.status}
                  </Badge>
                </div>
                <div className="tabular min-w-[110px] text-right text-body font-medium">{fmt(q.amount)}</div>
                <div className="min-w-[74px] text-right text-meta font-normal text-muted-60">{fmtShortDate(q.due)}</div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <div className="min-w-[200px] flex-1 text-meta font-normal text-muted-60">{q.history.join(' → ')}</div>
                {q.status === 'Pending' && (
                  <Button variant="secondary" size="sm" className="text-meta" disabled={busy} onClick={() => run(q.id, depositCheque)}>
                    {busy ? 'Working…' : 'Mark deposited'}
                  </Button>
                )}
                {q.status === 'Deposited' &&
                  (isAdmin ? (
                    <>
                      <Button variant="primary" size="sm" className="text-meta" disabled={busy} onClick={() => run(q.id, clearCheque)}>
                        {busy ? 'Working…' : 'Mark cleared'}
                      </Button>
                      <Button variant="outlineDestructive" size="sm" className="text-meta" disabled={busy} onClick={() => run(q.id, returnCheque)}>
                        {busy ? 'Working…' : 'Mark returned'}
                      </Button>
                    </>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="primary" size="sm" aria-disabled="true" className="cursor-not-allowed gap-1 text-meta opacity-50 hover:bg-accent-solid">
                          <Lock size={10} strokeWidth={2.4} aria-hidden="true" />
                          Mark cleared
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Clearing and returning a cheque needs Admin.</TooltipContent>
                    </Tooltip>
                  ))}
              </div>
              {errors[q.id] && <div className="mt-1.5 text-meta font-semibold text-negative">{errors[q.id]}</div>}
            </div>
          )
        })}
        {state.cheques.length === 0 && <EmptyState icon={Banknote} title="No cheques recorded yet" description="Cheques taken as settlement on a purchase, sale, or payment will show up here." />}
      </Card>
    </div>
  )
}
