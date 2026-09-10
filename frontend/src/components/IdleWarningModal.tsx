import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

/**
 * Shown for the final `IDLE_WARNING_SECONDS` before an idle sign-out (see lib/useIdleTimeout.ts).
 *
 * Deliberately NOT dismissible by clicking away or pressing Escape. Every other modal in this app
 * closes on a backdrop click, but here that gesture is ambiguous — a user brushing the mouse to
 * see what appeared would dismiss the warning without extending anything, and the sign-out would
 * then arrive with no warning at all, which is the exact outcome this exists to prevent. The only
 * way out is the button, which is unambiguous.
 *
 * Note that mouse movement alone does not cancel this. Once the warning is up the countdown runs
 * to zero unless the button is pressed. That is intentional: the point of the warning is to catch
 * the case where the desk has been left unattended, and a cat on the keyboard or a knocked mouse
 * should not silently keep a till session open.
 */
export function IdleWarningModal({ secondsLeft, onStay }: { secondsLeft: number; onStay: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 px-5"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-title"
      aria-describedby="idle-body"
    >
      <Card className="w-full max-w-[380px] overflow-hidden shadow-md">
        <div className="border-b border-border px-4 py-3">
          <div id="idle-title" className="text-body font-semibold">
            Still there?
          </div>
        </div>
        <div className="px-4 py-3.5">
          <div id="idle-body" className="text-body font-normal leading-relaxed text-muted-70">
            You'll be logged out in{' '}
            {/* aria-live so a screen reader announces the countdown rather than the user only
                discovering it when the session ends. "polite" not "assertive" — once a second,
                interrupting whatever else is being read would be worse than useless. */}
            <b className="tabular font-semibold text-ink" aria-live="polite">
              {secondsLeft}s
            </b>{' '}
            due to inactivity.
          </div>
          <div className="mt-1.5 text-meta font-normal leading-[1.5] text-muted-60">
            Anything you've typed but not yet confirmed will be lost.
          </div>
          <div className="mt-3.5 flex justify-end">
            <Button variant="primary" onClick={onStay} autoFocus>
              Stay logged in
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
