import type { ReportPreset } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { cn } from '@/lib/utils'

export interface PeriodPreset {
  key: ReportPreset
  label: string
}

interface PeriodFilterProps {
  presets: PeriodPreset[]
  preset: ReportPreset
  from: string
  to: string
  onPick: (key: ReportPreset) => void
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  onClear: () => void
  className?: string
}

/**
 * The date-range preset row built for the Margin Ledger — preset buttons, a From/To custom
 * range, and a Clear button that reappears once either date is set. Extracted here so a second
 * screen (Payments) can reuse the exact same control rather than rebuilding it; `presets` stays
 * caller-supplied since Income Statement's own preset set (all/month/lastMonth/30d/ytd) differs
 * from the Margin Ledger's and this component makes no assumption about which set is in use.
 *
 * Picking a preset is the caller's job (`onPick`), same for typing a custom date — this component
 * only renders the row and reports intent; it holds no state of its own.
 */
export function PeriodFilter({ presets, preset, from, to, onPick, onFromChange, onToChange, onClear, className }: PeriodFilterProps) {
  const rangeActive = !!(from || to)
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="text-meta font-medium uppercase tracking-wide text-muted-60">Period</span>
      {presets.map((p) => (
        <Button
          key={p.key}
          type="button"
          variant="secondary"
          size="sm"
          aria-pressed={preset === p.key && !rangeActive}
          onClick={() => onPick(p.key)}
          className={cn('text-meta', preset === p.key && !rangeActive && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
        >
          {p.label}
        </Button>
      ))}
      <span className="h-5 w-px bg-border" aria-hidden="true" />
      <DatePicker value={from} onChange={onFromChange} placeholder="From" />
      <span className="text-meta font-normal text-muted-60">to</span>
      <DatePicker value={to} onChange={onToChange} placeholder="To" />
      {rangeActive && (
        <Button type="button" variant="secondary" size="sm" className="text-meta" onClick={onClear}>
          Clear
        </Button>
      )}
    </div>
  )
}
