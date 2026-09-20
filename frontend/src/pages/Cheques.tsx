import { useState } from 'react'
import { Banknote, Lock, ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import { useStore } from '@/lib/store'
import { chequeIsOpen, chequeIsOverdue } from '@/lib/engine'
import { fmt, fmtShortDate, todayISO } from '@/lib/format'
import { statusMeta } from '@/lib/ui-helpers'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { KpiCard } from '@/components/ui/kpi-card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function Cheques() {
  const { state, isAdmin, depositCheque, clearCheque, returnCheque, cancelCheque } = useStore()
  // `chequeIsOpen` rather than a hand-written status list: a cheque is uncleared while it is
  // Pending or Deposited, and Cancelled had to join Cleared and Returned as a finished state the
  // moment it existed. Naming the two live states is the version that cannot be forgotten when a
  // sixth status arrives.
  const inward = state.cheques.filter((q) => q.direction === 'Inward' && chequeIsOpen(q))
  const outward = state.cheques.filter((q) => q.direction === 'Outward' && chequeIsOpen(q))

  // Recomputed per render from the desk's own day. Cheap, and it means the page is never showing
  // yesterday's idea of what is late.
  const today = todayISO()
  const overdueCount = (list: typeof inward) => list.filter((q) => chequeIsOverdue(q, today)).length

  const [showOverdueOnly, setShowOverdueOnly] = useState(false)
  const [sortByDue, setSortByDue] = useState(false)

  const filtered = showOverdueOnly ? state.cheques.filter((q) => chequeIsOverdue(q, today)) : state.cheques
  // Soonest first, which is the order you act in. `due` is a plain 'YYYY-MM-DD', so a string
  // compare is a calendar compare — no Date object, no timezone. Not memoised: React Compiler
  // reported it could not preserve the manual memo here, and this is a handful of rows.
  const rows = sortByDue ? filtered.slice().sort((a, b) => (a.due || '').localeCompare(b.due || '')) : filtered

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
        {/* The overdue count rides in the caption rather than taking a tile of its own: it is a
            property OF the uncleared figure, not a separate quantity, and splitting it out would
            invite reading the two as amounts that add up. */}
        <KpiCard
          tone="positive"
          icon={ArrowDownCircle}
          label="Inward uncleared"
          size="md"
          caption={`${inward.length} — still counted in receivables${overdueCount(inward) ? ` · ${overdueCount(inward)} overdue` : ''}`}
        >
          <div className="tabular text-hero font-semibold tracking-tight text-white">{fmt(inward.reduce((s, q) => s + q.amount, 0))}</div>
        </KpiCard>
        <KpiCard
          tone="negative"
          icon={ArrowUpCircle}
          label="Outward uncleared"
          size="md"
          caption={`${outward.length} — still counted in payables${overdueCount(outward) ? ` · ${overdueCount(outward)} overdue` : ''}`}
        >
          <div className="tabular text-hero font-semibold tracking-tight text-white">{fmt(outward.reduce((s, q) => s + q.amount, 0))}</div>
        </KpiCard>
      </div>

      {state.cheques.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-pressed={sortByDue}
            onClick={() => setSortByDue((v) => !v)}
            className={cn('text-meta', sortByDue && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
          >
            Sort by due date
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-pressed={showOverdueOnly}
            onClick={() => setShowOverdueOnly((v) => !v)}
            className={cn('gap-1 text-meta', showOverdueOnly && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
          >
            Overdue only
            <span className="tabular text-meta opacity-70">{overdueCount(inward) + overdueCount(outward)}</span>
          </Button>
        </div>
      )}

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
        {rows.map((q) => {
          const status = statusMeta(q.status)
          const StatusIcon = status.icon
          const busy = pendingId === q.id
          const overdue = chequeIsOverdue(q, today)
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
                {/* Overdue is shown ON the due date rather than as another status pill: the cheque's
                    status is still genuinely Pending or Deposited, and a second pill next to it
                    would read as a competing state. Colour plus the word marks the date itself as
                    the thing that has gone wrong — and the word matters, since colour alone would
                    be the only signal for anyone who cannot distinguish it. */}
                <div className={cn('min-w-[74px] text-right text-meta font-normal', overdue ? 'font-medium text-negative-deep' : 'text-muted-60')}>
                  {fmtShortDate(q.due)}
                  {overdue && <span className="ml-1 font-semibold">overdue</span>}
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <div className="min-w-[200px] flex-1 text-meta font-normal text-muted-60">{q.history.join(' → ')}</div>
                {q.status === 'Pending' && (
                  <Button variant="secondary" size="sm" className="text-meta" disabled={busy} onClick={() => run(q.id, depositCheque)}>
                    {busy ? 'Working…' : 'Mark deposited'}
                  </Button>
                )}
                {/* Cancel is offered only while Pending — once deposited the cheque is with the
                    bank and its outcome is Cleared or Returned, not cancelled. Admin only, matching
                    the server guard: an operator would otherwise fill in a confirmation and get a
                    403 at the end of it. */}
                {q.status === 'Pending' && isAdmin && (
                  <Button variant="outlineDestructive" size="sm" className="text-meta" disabled={busy} onClick={() => run(q.id, cancelCheque)}>
                    {busy ? 'Working…' : 'Cancel cheque'}
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
        {state.cheques.length === 0 && <EmptyState category="cheques" icon={Banknote} title="No cheques recorded yet" description="Cheques taken as settlement on a purchase, sale, or payment will show up here." />}
      </Card>
    </div>
  )
}
