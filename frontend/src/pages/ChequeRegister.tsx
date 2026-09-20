import { Banknote } from 'lucide-react'
import { useStore } from '@/lib/store'
import { chequeRegister } from '@/lib/chequeRegister'
import { fmt, fmtLongDate, todayISO } from '@/lib/format'
import { Card } from '@/components/ui/card'
import { ChequeStatusBadge, OverdueFor } from '@/components/ChequeStatusBadge'
import { EmptyState } from '@/components/ui/empty-state'
import { PrintHeader } from '@/components/PrintHeader'

// The cheque register — every cheque as one accounting line, grouped by the day it was received.
//
// A VIEW, not an entry screen. Cheques are entered through Receive/Make Payment, which writes the
// cheque and the payment behind it in one transaction. A second way in would either duplicate that
// pair or write a cheque with no payment behind it — which looks correct and produces wrong books,
// because clearing moves a balance that was never raised.
//
// Dr/Cr are DERIVED and shown read-only. The backend has never let anyone pick them: an inward
// cheque debits the desk's bank and credits the customer, an outward one is the mirror, and both
// accounts were fixed at entry. See chequeLegs(), which mirrors the backend's chequeClearingSides.
export function ChequeRegister() {
  const { state } = useStore()
  const days = chequeRegister(state.cheques, state.activity, state.accounts)
  const today = todayISO()
  const total = days.reduce((s, d) => s + d.total, 0)

  return (
    <div>
      <PrintHeader title="Cheque register" />
      <h1 className="m-0 mb-[3px] text-heading font-semibold">Cheque Register</h1>
      <div className="mb-[26px] text-body font-normal text-muted-60">
        Every cheque as one line, by the date it was received. The accounts are the ones the entry posts to when the cheque clears — nothing is posted while it is still
        outstanding. Cheques are recorded on Receive or Make Payment.
      </div>

      {days.length > 0 && (
        <div className="mb-3 flex items-baseline justify-between text-meta font-normal text-muted-70">
          <span>
            {days.reduce((n, d) => n + d.rows.length, 0)} cheques over {days.length} {days.length === 1 ? 'day' : 'days'}
          </span>
          <span className="tabular">
            Total <b className="font-semibold text-ink">{fmt(total)}</b>
          </span>
        </div>
      )}

      {days.map((day) => (
        <Card key={day.date} className="mb-4 overflow-hidden">
          <div className="flex items-baseline justify-between border-b border-border bg-surface-sunken px-[13px] py-2">
            <div className="text-body font-semibold">{fmtLongDate(day.date)}</div>
            <div className="tabular text-meta font-normal text-muted-70">
              {day.rows.length} {day.rows.length === 1 ? 'cheque' : 'cheques'} · <b className="font-semibold text-ink">{fmt(day.total)}</b>
            </div>
          </div>
          <div className="flex items-center gap-3 border-b border-divider px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
            <div className="w-[168px] flex-none">Cheque date</div>
            <div className="w-[86px] flex-none">Cheque no.</div>
            <div className="w-[150px] flex-none">Account (Dr)</div>
            <div className="w-[150px] flex-none">Account (Cr)</div>
            <div className="min-w-0 flex-1">Description</div>
            <div className="w-[104px] flex-none">Status</div>
            <div className="w-[120px] flex-none text-right">Amount</div>
          </div>
          {day.rows.map((r) => {
            const cheque = state.cheques.find((q) => q.id === r.id)
            return (
              <div key={r.id} className="flex items-center gap-3 border-b border-divider px-[13px] py-2.5 text-body transition-colors duration-150 hover:bg-surface-hover">
                {/* Date and chip as separate elements with a real gap — see OverdueChip. */}
                <div className="flex w-[168px] flex-none items-center gap-2">
                  <span className="tabular whitespace-nowrap text-meta text-muted-70">{fmtLongDate(r.chequeDate)}</span>
                  <OverdueFor cheque={cheque} today={today} />
                </div>
                <div className="tabular w-[86px] flex-none text-meta font-normal text-muted-70">{r.number}</div>
                {/* Read-only, and styled as data rather than as fields: these are not choices
                    anyone makes, they are what the posting will be. */}
                <div className="w-[150px] flex-none truncate font-medium" title={r.debitAccount}>
                  {r.debitAccount}
                </div>
                <div className="w-[150px] flex-none truncate font-medium" title={r.creditAccount}>
                  {r.creditAccount}
                </div>
                <div className="min-w-0 flex-1 truncate font-normal text-muted-70" title={r.description}>
                  {r.description}
                </div>
                <div className="w-[104px] flex-none">
                  <ChequeStatusBadge status={r.status} />
                </div>
                <div className="tabular w-[120px] flex-none text-right font-medium">{fmt(r.amount)}</div>
              </div>
            )
          })}
        </Card>
      ))}

      {days.length === 0 && (
        <EmptyState
          category="cheques"
          icon={Banknote}
          title="No cheques recorded yet."
          description="Cheques appear here once one is taken on Receive Payment or Make Payment. This page lists them; it does not record them."
          className="py-8"
        />
      )}
    </div>
  )
}
