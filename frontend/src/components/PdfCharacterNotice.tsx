import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { TextWarning } from '@/lib/pdfText'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

/**
 * Shown BEFORE a statement PDF opens, when some text in it had to be changed to be printable.
 *
 * The PDF's built-in font cannot print every character — Arabic and Urdu names, arrows and the like.
 * Left alone they would come out as gibberish, so they are replaced with "?" and this dialog says so:
 * which field, and which characters. Nothing is hidden from the person handing the statement to a
 * customer, who can cancel and fix the name first or knowingly carry on.
 *
 * Styled like AccountFormModal (same overlay and Card) rather than a second modal look, and built by
 * hand because the UI kit has no dialog primitive and one warning is not a reason to add a dependency.
 * Keyboard: Escape cancels; focus starts on Cancel, the safe choice.
 */
export function PdfCharacterNotice({
  warnings,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  warnings: TextWarning[]
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/35 px-5 pb-5 pt-[70px] print:hidden" onClick={onCancel}>
      <Card
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pdf-notice-title"
        aria-describedby="pdf-notice-body"
        className="w-full max-w-[520px] overflow-hidden shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
          <AlertTriangle size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-pending" />
          <div id="pdf-notice-title" className="text-body font-semibold">
            Some text can't be printed in the PDF
          </div>
        </div>
        <div className="flex flex-col gap-2.5 p-3.5">
          <p id="pdf-notice-body" className="m-0 text-body text-muted-70">
            The PDF's font can't print the characters below, so each will appear as <strong className="text-ink">?</strong>. The statement's figures are not affected.
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {warnings.map((w) => (
              <li key={w.field} className="rounded-control border border-divider bg-surface-sunken px-3 py-2 text-body">
                <div className="font-semibold">{w.field}</div>
                <div className="text-muted-70">
                  Can't print: <span className="font-medium text-ink">{w.characters.map((c) => `“${c}”`).join('  ')}</span>
                </div>
                <div className="text-muted-70">
                  Will print as: <span className="font-mono text-ink">{w.printedAs}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-end gap-2 border-t border-divider pt-2.5">
            <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
