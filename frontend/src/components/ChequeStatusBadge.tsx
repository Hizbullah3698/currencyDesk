import { chequeIsOverdue } from '@/lib/engine'
import { statusMeta } from '@/lib/ui-helpers'
import type { Cheque } from '@/lib/types'
import { Badge } from '@/components/ui/badge'

/**
 * A cheque's status, rendered the same way everywhere it appears.
 *
 * The Cheques page and the Cheque Register each built this pairing by hand — the same `statusMeta`
 * lookup, the same icon props, the same Badge — which is two places to keep in step for something
 * that must never differ. Colour and icon per status stay in STATUS_META; this is only the one
 * agreed way of showing them.
 */
export function ChequeStatusBadge({ status }: { status: string }) {
  const meta = statusMeta(status)
  const Icon = meta.icon
  return (
    <Badge variant={meta.variant}>
      <Icon size={10} strokeWidth={2.4} aria-hidden="true" />
      {status}
    </Badge>
  )
}

/**
 * The overdue marker, as a chip of its own rather than red text run against the date.
 *
 * It is deliberately NOT a second status badge sitting beside the first: the cheque's status is
 * still genuinely Pending or Deposited, and two pills side by side read as two competing states.
 * A smaller chip, tied to the date it qualifies, says "this date has passed" instead.
 *
 * The word carries the meaning, not the colour — colour alone would be the only signal for anyone
 * who cannot distinguish it.
 */
export function OverdueChip() {
  return (
    <span className="inline-flex flex-none items-center rounded-data border border-negative-border bg-negative-bg px-1.5 py-px text-[10px] font-semibold uppercase leading-normal tracking-wide text-negative-deep">
      Overdue
    </span>
  )
}

/** Convenience for the two list pages: the chip only when the cheque is actually overdue. */
export function OverdueFor({ cheque, today }: { cheque: Cheque | undefined; today: string }) {
  if (!cheque || !chequeIsOverdue(cheque, today)) return null
  return <OverdueChip />
}
