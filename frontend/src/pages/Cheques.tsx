import { useState } from 'react'
import { Banknote, Lock, ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import { useStore } from '@/lib/store'
import { chequeIsOpen, chequeIsOverdue } from '@/lib/engine'
import { fmt, fmtShortDate, todayISO } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ChequeStatusBadge, OverdueFor } from '@/components/ChequeStatusBadge'
import { ChequeHistoryLine } from '@/components/ChequeHistoryLine'
import { KpiCard } from '@/components/ui/kpi-card'
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
        {/* Fixed widths, and an ACTIONS column reserved at the end. Actions used to sit on a
            second line under the data, so a row's height depended on how many buttons it happened
            to offer and nothing lined up down the page. Reserving the zone here means the header
            and every row agree on where the data stops and the controls begin. */}
        <div className="flex items-center gap-3 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
          <div className="w-[78px] flex-none">Direction</div>
          <div className="w-[92px] flex-none">Cheque no.</div>
          <div className="min-w-0 flex-1">Party</div>
          <div className="w-[96px] flex-none">Bank</div>
          <div className="w-[104px] flex-none">Status</div>
          <div className="w-[112px] flex-none text-right">Amount</div>
          <div className="w-[136px] flex-none">Due</div>
          <div className="w-[216px] flex-none text-right">Actions</div>
        </div>
        {rows.map((q) => {
          const busy = pendingId === q.id
          const overdue = chequeIsOverdue(q, today)
          return (
            <div key={q.id} className="border-b border-divider px-[13px] py-3 transition-colors duration-150 hover:bg-surface-hover">
              <div className="flex items-center gap-3">
                <div className={cn('w-[78px] flex-none text-body font-medium', q.direction === 'Inward' ? 'text-positive' : 'text-ink')}>{q.direction}</div>
                <div className="tabular w-[92px] flex-none truncate text-body font-normal text-muted-70">{q.number}</div>
                <div className="min-w-0 flex-1 truncate text-body font-semibold">{q.party}</div>
                <div className="w-[96px] flex-none truncate text-body font-normal text-muted-70">{q.bank}</div>
                <div className="w-[104px] flex-none">
                  <ChequeStatusBadge status={q.status} />
                </div>
                <div className="tabular w-[112px] flex-none text-right text-body font-medium">{fmt(q.amount)}</div>
                {/* Date and chip are separate elements with a real gap, not a word tacked onto the
                    end of the date — see OverdueChip for why this is a chip of its own rather than
                    a second status pill. */}
                <div className="flex w-[136px] flex-none items-center gap-2">
                  <span className={cn('tabular text-meta', overdue ? 'font-medium text-negative-deep' : 'font-normal text-muted-60')}>{fmtShortDate(q.due)}</span>
                  <OverdueFor cheque={q} today={today} />
                </div>
                {/* One zone, fixed width, right-aligned, whatever the row offers. Its width holds
                    the widest pair ("Mark cleared" + "Mark returned") so a row with two actions is
                    exactly as tall as one with none. */}
                <div className="flex w-[216px] flex-none items-center justify-end gap-2">
                  {q.status === 'Pending' && (
                    <>
                      {/* The natural next step is the single primary action; cancelling is the
                          exception beside it. */}
                      <Button variant="primary" size="sm" className="text-meta" disabled={busy} onClick={() => run(q.id, depositCheque)}>
                        {busy ? 'Working…' : 'Mark deposited'}
                      </Button>
                      {/* Cancel is offered only while Pending — once deposited the cheque is with
                          the bank and its outcome is Cleared or Returned, not cancelled. Admin
                          only, matching the server guard: an operator would otherwise fill in a
                          confirmation and get a 403 at the end of it.
                          `border-solid` overrides the variant's dashed edge, which reads as a
                          disabled control rather than a deliberate destructive one — the same
                          override AccountFormModal already applies to its own delete button. */}
                      {isAdmin && (
                        <Button variant="outlineDestructive" size="sm" className="border-solid text-meta" disabled={busy} onClick={() => run(q.id, cancelCheque)}>
                          {busy ? 'Working…' : 'Cancel'}
                        </Button>
                      )}
                    </>
                  )}
                  {q.status === 'Deposited' &&
                    (isAdmin ? (
                      <>
                        <Button variant="primary" size="sm" className="text-meta" disabled={busy} onClick={() => run(q.id, clearCheque)}>
                          {busy ? 'Working…' : 'Mark cleared'}
                        </Button>
                        <Button variant="outlineDestructive" size="sm" className="border-solid text-meta" disabled={busy} onClick={() => run(q.id, returnCheque)}>
                          {busy ? 'Working…' : 'Returned'}
                        </Button>
                      </>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="primary" size="sm" aria-disabled="true" className="cursor-not-allowed gap-1.5 text-meta opacity-50 hover:bg-accent-solid">
                            <Lock size={10} strokeWidth={2.4} aria-hidden="true" />
                            Mark cleared
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Clearing and returning a cheque needs Admin.</TooltipContent>
                      </Tooltip>
                    ))}
                </div>
              </div>
              {/* Indented to sit under the data rather than under the row edge, so it reads as
                  belonging to the record above it. */}
              <div className="mt-2 pl-[86px]">
                <ChequeHistoryLine history={q.history} />
              </div>
              {errors[q.id] && <div className="mt-2 pl-[86px] text-meta font-semibold text-negative">{errors[q.id]}</div>}
            </div>
          )
        })}
        {state.cheques.length === 0 && <EmptyState category="cheques" icon={Banknote} title="No cheques recorded yet" description="Cheques taken as settlement on a purchase, sale, or payment will show up here." />}
      </Card>
    </div>
  )
}
