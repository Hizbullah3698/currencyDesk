import { useCallback, useEffect, useRef, useState } from 'react'
import { IDLE_WARNING_SECONDS } from '@currencydesk/engine'
import { lastActivity, markActivity, needsKeepalive, resetActivity } from './activity'
import * as authClient from './authClient'

// ---------------------------------------------------------------------------
// Idle timeout — client half
// ---------------------------------------------------------------------------
//
// This warns the user and signs them out tidily. It is NOT the security control: someone who
// disables JavaScript never runs it. The control is the server-side session window
// (backend/src/middleware/sessionIdleTimeout.ts), which expires the session independently.
//
// The two are kept aligned by the keepalive in activity.ts — local activity with no requests would
// otherwise let the server session lapse while this timer still showed plenty of time left.

/** How long before expiry the warning appears. Re-exported from the engine so the Settings page's
 *  copy ("A warning appears N seconds beforehand") and this countdown cannot drift apart. */
export const WARNING_SECONDS = IDLE_WARNING_SECONDS

/** How often the timer re-evaluates. One second is enough for a per-second countdown and is
 *  cheap; the check itself is two subtractions. */
const TICK_MS = 1000

/**
 * Events that count as "the user is here".
 *
 * `visibilitychange` is included because returning to a backgrounded tab is a deliberate act, and
 * `scroll`/`wheel` because reading a long ledger involves neither mouse movement over an element
 * nor a keypress — a reader would otherwise be logged out mid-page.
 *
 * Registered passive, so none of them can delay scrolling.
 */
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel', 'visibilitychange'] as const

/** mousemove fires continuously; recording every one would be wasteful for no added fidelity. */
const ACTIVITY_THROTTLE_MS = 1000

export interface IdleState {
  /** True once the countdown has started. Drives the warning modal. */
  warning: boolean
  /** Whole seconds left until sign-out. Only meaningful while `warning` is true. */
  secondsLeft: number
  /** Dismisses the warning, resets the clock, and — importantly — tells the server too. */
  stayLoggedIn: () => void
}

/**
 * @param timeoutMinutes  the admin-configured window, from GET /api/settings
 * @param enabled         false while signed out, so no timer runs on the login screen
 * @param onTimeout       invoked once when the window elapses; expected to sign the user out
 */
export function useIdleTimeout(timeoutMinutes: number, enabled: boolean, onTimeout: () => void): IdleState {
  const [warning, setWarning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(WARNING_SECONDS)

  // Held in refs, not state: these change on every mousemove and every tick, and re-rendering the
  // whole app for them would be a genuine performance problem on a page with a large ledger table.
  const firedRef = useRef(false)

  // The latest-callback ref, kept current in an effect rather than assigned during render.
  // Its purpose is so the interval below always calls the newest onTimeout without having to list
  // it as a dependency — which would tear down and restart the timer on every parent re-render,
  // quietly resetting the countdown and meaning it could never actually reach zero.
  const onTimeoutRef = useRef(onTimeout)
  useEffect(() => {
    onTimeoutRef.current = onTimeout
  }, [onTimeout])

  const stayLoggedIn = useCallback(() => {
    resetActivity()
    setWarning(false)
    setSecondsLeft(WARNING_SECONDS)
    // Resetting the local clock alone would be a lie: the SERVER's window is what actually ends
    // the session, and it only moves when a request arrives. Without this, "Stay logged in" would
    // visibly dismiss the modal and then fail the user's next action anyway.
    void authClient.refreshCsrfToken()
  }, [])

  // --- record activity -----------------------------------------------------
  useEffect(() => {
    if (!enabled) return
    let lastRecorded = 0
    const handler = () => {
      const now = Date.now()
      if (now - lastRecorded < ACTIVITY_THROTTLE_MS) return
      lastRecorded = now
      markActivity()
    }
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, handler, { passive: true })
    }
    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, handler)
    }
  }, [enabled])

  // --- evaluate the window -------------------------------------------------
  useEffect(() => {
    if (!enabled) {
      setWarning(false)
      firedRef.current = false
      return
    }

    // A fresh window whenever the timeout changes or the user signs in, so an admin lowering the
    // setting doesn't instantly expire everyone who was already idle.
    resetActivity()
    firedRef.current = false
    setWarning(false)
    setSecondsLeft(WARNING_SECONDS)

    const timeoutMs = Math.max(timeoutMinutes, 1) * 60 * 1000
    const warnAtMs = Math.max(timeoutMs - WARNING_SECONDS * 1000, 0)

    const id = window.setInterval(() => {
      const idleFor = Date.now() - lastActivity()

      if (idleFor >= timeoutMs) {
        // Guarded so a slow sign-out cannot fire twice while the interval keeps ticking.
        if (firedRef.current) return
        firedRef.current = true
        onTimeoutRef.current()
        return
      }

      if (idleFor >= warnAtMs) {
        setWarning(true)
        setSecondsLeft(Math.max(Math.ceil((timeoutMs - idleFor) / 1000), 0))
        return
      }

      setWarning(false)

      // The user is active locally but may not have made a request in a while. Keep the server's
      // window in step, so the two clocks cannot drift apart. Only while genuinely not idle —
      // during the warning period we deliberately let the server session lapse alongside the
      // client one unless the user actually clicks "Stay logged in".
      if (needsKeepalive()) void authClient.refreshCsrfToken()
    }, TICK_MS)

    return () => window.clearInterval(id)
  }, [enabled, timeoutMinutes])

  return { warning, secondsLeft, stayLoggedIn }
}
