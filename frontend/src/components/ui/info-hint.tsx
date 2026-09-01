import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * The app's one way to attach an explanation to something without spending a line of layout on it.
 *
 * Established by the Transaction Date field and now used wherever the alternative is a paragraph of
 * prose sitting permanently in the page flow: an accounting convention, a "how this is computed"
 * note, anything a user reads once and never needs again. Instruction goes behind the icon; a
 * figure that changes with the data stays visible.
 *
 * Extracted from FieldLabel, which now renders this, so a second copy of the markup cannot drift
 * from the first — the icon size, its muted-to-ink hover and the keyboard-reachable button are the
 * recognisable part of the pattern.
 */
export function InfoHint({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* type=button so it never submits a form, and a real button so it is keyboard
            reachable — the explanation is not mouse-only. */}
        <button type="button" aria-label={text} className={cn('inline-flex flex-none text-muted-42 transition-colors duration-150 hover:text-muted-70', className)}>
          <Info size={12} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px]">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}
