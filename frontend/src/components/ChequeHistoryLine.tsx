import { ChevronRight } from 'lucide-react'

/**
 * A cheque's lifecycle, one step at a time.
 *
 * Was `history.join(' → ')`, which produced a single unbroken string — "Recorded Sep 20 →
 * Cancelled Sep 20" — where the arrow sat flush against the words on both sides and the steps ran
 * together at a glance. Each step now gets its own element with real space around the separator,
 * so the sequence reads as a sequence.
 *
 * Deliberately quieter than the row's own data: this is provenance, not a figure anyone acts on,
 * so it sits a tier down in both size and colour. Wraps rather than truncates — a cheque that has
 * been through every transition has a genuinely long history and cutting it off would hide the
 * part that explains how it got where it is.
 */
export function ChequeHistoryLine({ history }: { history: string[] }) {
  if (history.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-meta font-normal leading-normal text-muted-60">
      {history.map((step, i) => (
        <span key={`${step}-${i}`} className="inline-flex items-center gap-x-1.5">
          {i > 0 && <ChevronRight size={11} strokeWidth={2.2} className="flex-none text-muted-42" aria-hidden="true" />}
          <span>{step}</span>
        </span>
      ))}
    </div>
  )
}
