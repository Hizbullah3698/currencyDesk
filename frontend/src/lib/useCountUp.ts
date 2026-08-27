import { useEffect, useRef, useState } from 'react'

/**
 * The app's single deliberate motion moment: the Dashboard's headline net-cash
 * figure counts up once, on the first load that actually has a figure to show.
 * Everything else in the app stays at a flat 150-200ms functional transition —
 * see the motion audit note in index.css. Do not reach for this a second time;
 * a "signature" moment stops being one the instant it is repeated.
 *
 * Behaviour that matters:
 *  - Animates the MAGNITUDE only. The caller keeps the sign and the up/down
 *    icon driven by the real value, so a negative net doesn't flicker its
 *    direction mid-count.
 *  - Fires once per mount, and only for the first non-zero value. Business data
 *    arrives asynchronously, so the first render is usually 0 — treating that as
 *    "already animated" would silently disable the effect. A later refetch
 *    snaps straight to the new number rather than re-animating, so routine data
 *    refreshes never look like a re-entry animation.
 *  - Honours prefers-reduced-motion by skipping straight to the final value.
 *    The global reduced-motion block in index.css only covers CSS animation and
 *    transition; a requestAnimationFrame loop has to opt out on its own.
 *  - Never changes the value that is finally displayed — it only controls how
 *    that number is reached, so no figure this drives can be misreported.
 */
export function useCountUp(target: number, durationMs = 850): number {
  const [display, setDisplay] = useState(target)
  const animatedRef = useRef(false)

  useEffect(() => {
    // No figure yet (data still loading) — show it as-is and stay armed.
    if (!target) {
      setDisplay(target)
      return
    }
    if (animatedRef.current) {
      setDisplay(target)
      return
    }
    animatedRef.current = true

    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (reduced) {
      setDisplay(target)
      return
    }

    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      // easeOutCubic — decelerates into the final value, no overshoot/bounce.
      setDisplay(target * (1 - Math.pow(1 - t, 3)))
      if (t < 1) raf = requestAnimationFrame(tick)
      else setDisplay(target)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])

  return display
}
