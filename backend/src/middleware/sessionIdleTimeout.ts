import type { Request, Response, NextFunction } from 'express'
import { getIdleTimeoutMinutes } from '../services/settingsService.js'

// ---------------------------------------------------------------------------
// Server-side idle expiry
// ---------------------------------------------------------------------------
//
// This is the half that actually enforces the timeout. The client-side timer (frontend
// lib/useIdleTimeout.ts) exists to warn the user and to sign them out tidily; it is a courtesy,
// not a control. Someone who disables JavaScript, edits it, or replays a stolen cookie from a
// different machine never runs that timer at all — so the session itself has to die on its own.
//
// NO NEW MECHANISM IS NEEDED FOR THIS. express-session is already configured with `rolling: true`,
// which rewrites the cookie and pushes the store's expiry forward on every response. That is
// precisely an idle timeout: the session dies a fixed period after the LAST request, not a fixed
// period after login. All that was missing is that the window was 30 days.
//
// So this middleware does one thing: set the window per request from the current admin setting.
// It must run AFTER sessionMiddleware (it reads req.session) and BEFORE the routes, so the value
// is in place by the time express-session saves at the end of the response.
//
// Why per request rather than once at startup: `maxAge` is baked into the session middleware when
// it is constructed, so a setting change would otherwise need a redeploy — which is exactly the
// limitation that made this a settings row instead of an env var in the first place.

/**
 * Sets the idle window on whatever session `req` currently holds.
 *
 * Exported because the middleware below cannot cover login. Middleware runs before the route, and
 * the login handler only establishes identity *inside* the route — so at middleware time a
 * logging-in request still looks anonymous, gets skipped, and the very first response of the
 * session would go out carrying the default 30-day cookie instead of the idle window. routes/auth.ts
 * therefore calls this again once the session is real.
 */
export async function applyIdleWindow(req: Request): Promise<void> {
  if (!req.session) return
  try {
    const minutes = await getIdleTimeoutMinutes()
    // Assigning maxAge also recomputes `expires` from now, which is what connect-pg-simple writes
    // to the session row's expire column. Combined with rolling:true, every authenticated request
    // therefore resets the clock — and a quiet period lets it lapse.
    req.session.cookie.maxAge = minutes * 60 * 1000
  } catch (err) {
    // Never fail a request over this. getIdleTimeoutMinutes already falls back to the default on a
    // database problem, so reaching here means something more unusual; the session simply keeps
    // whatever window it had, which is the safe direction (an existing window, not none).
    console.error('[idle-timeout] could not apply the idle window to this session', err)
  }
}

export async function applySessionIdleTimeout(req: Request, _res: Response, next: NextFunction): Promise<void> {
  // No established session means nothing to expire; skip the settings lookup entirely so
  // unauthenticated traffic (health checks, the login page itself) costs nothing. Login is handled
  // separately — see applyIdleWindow above.
  if (!req.session || !req.session.userId) {
    next()
    return
  }
  await applyIdleWindow(req)
  next()
}
