import { InfoHint } from '@/components/ui/info-hint'

/**
 * A form label with optional explanatory text behind an info icon, and an optional short reference
 * figure sitting on the same line, right-aligned.
 *
 * Exists so the clarification a field sometimes needs stops being a second line of prose under the
 * control. The transaction-date field had grown a label, a second line that read like another
 * heading, and a full sentence of helper text — three lines of chrome around one date box, on a
 * screen a dealer works through dozens of times a day.
 *
 * The rule: if a field needs explaining, the explanation goes behind the icon (see InfoHint, which
 * this shares with the rest of the app), not into the layout. If a field needs a live reference
 * figure — an available balance, an average cost — that is information rather than instruction, so
 * it stays visible, but as `aside` on the label's own line rather than as another stacked caption
 * underneath the control. A unit that belongs to the value being typed (a currency code) is
 * neither: it goes inside the input as an affix.
 */
export function FieldLabel({
  children,
  hint,
  htmlFor,
  aside,
}: {
  children: React.ReactNode
  hint?: string
  htmlFor?: string
  /** A short reference figure shown to the right of the label. Keep it to a few characters. */
  aside?: React.ReactNode
}) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <label htmlFor={htmlFor} className="flex min-w-0 items-center gap-1 text-meta font-semibold text-muted-70">
        <span className="truncate">{children}</span>
        {hint && <InfoHint text={hint} />}
      </label>
      {/* Sans, not `.tabular`: this is a single inline hint, never a column of figures to compare
          down the page, and the mono face is wide enough that a nine-figure IRR balance would push
          the label into truncating beside it. `tabular-nums` alone still holds the digits even. */}
      {aside && <span className="flex-none text-meta font-normal tabular-nums text-muted-60">{aside}</span>}
    </div>
  )
}
