import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * A form label with optional explanatory text behind an info icon.
 *
 * Exists so the clarification a field sometimes needs stops being a second line of prose under the
 * control. The transaction-date field had grown a label, a second line that read like another
 * heading, and a full sentence of helper text — three lines of chrome around one date box, on a
 * screen a dealer works through dozens of times a day.
 *
 * The rule: if a field needs explaining, the explanation goes behind the icon, not into the layout.
 * A caption line is only right when it changes with the data (an available balance, a rate
 * convention), because that is information rather than instruction.
 */
export function FieldLabel({ children, hint, htmlFor }: { children: React.ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 flex items-center gap-1 text-meta font-semibold text-muted-70">
      {children}
      {hint && (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* type=button so it never submits a form, and a real button so it is keyboard
                reachable — the explanation is not mouse-only. */}
            <button type="button" aria-label={hint} className="inline-flex text-muted-42 transition-colors duration-150 hover:text-muted-70">
              <Info size={12} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px]">
            {hint}
          </TooltipContent>
        </Tooltip>
      )}
    </label>
  )
}
