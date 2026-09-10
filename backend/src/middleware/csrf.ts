import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { env } from '../config/env.js'
import { pool } from '../db/pool.js'

// ---------------------------------------------------------------------------
// CSRF protection — synchroniser token, session-bound
// ---------------------------------------------------------------------------
//
// WHY THIS IS NEEDED, given the app already has CORS and SameSite:
// In production the frontend and backend are separate Vercel projects on different origins, so
// the session cookie has to be `SameSite=None; Secure` — which means the browser DOES attach it
// to cross-site requests. The older reasoning in this codebase ("routes are POST-only and
// SameSite=Lax blocks cross-site POSTs") was correct when it was written and is simply no longer
// true of the deployed configuration.
//
// What has been holding the line since then is incidental rather than designed: every mutating
// route takes `Content-Type: application/json`, which is not a CORS-simple content type, so the
// browser preflights, the origin allowlist rejects it, and the request never lands. That breaks
// the moment anyone adds a form-encoded or text/plain route, relaxes express.json(), adds a
// mutating GET, widens FRONTEND_ORIGIN, or introduces a subdomain an XSS could speak from — none
// of which would fail a test or look wrong in review.
//
// WHY A TOKEN IN THE RESPONSE BODY, NOT A DOUBLE-SUBMIT COOKIE:
// Double-submit needs the token in a cookie the frontend's JS can read. Across two origins that
// means a readable cross-site cookie, which is exactly the thing that is awkward here. Handing
// the token back in the login/me response body and keeping it in SPA memory sidesteps that
// entirely, and binding it to the server-side session (rather than trusting the cookie to match
// itself) is strictly stronger — a subdomain that could write cookies still cannot forge this.
//
// ROLLOUT — this is deployed in three stages, deliberately not collapsed:
//   1. Backend accepts and validates the token if present, but does NOT reject its absence.
//      (`CSRF_ENFORCE` unset/false — the current default.)
//   2. Frontend starts sending it on every mutating request.
//   3. Backend starts rejecting mutating requests that lack it (`CSRF_ENFORCE=true`).
// Enforcement is an env flag rather than a code change specifically so stage 3 can be reverted by
// flipping one variable, without shipping a rollback. Collapsing these stages would lock out
// every user whose browser still holds a cached pre-stage-2 bundle.
// ---------------------------------------------------------------------------

export const CSRF_HEADER = 'x-csrf-token'

/**
 * The `code` on both CSRF 403 responses. The client refreshes its token and retries once on a
 * CSRF rejection but not on an ordinary "Admin access required" 403, and matching on this rather
 * than on a substring of the human message means a reworded message cannot silently break that.
 */
export const CSRF_ERROR_CODE = 'CSRF_TOKEN'

/** 32 bytes of CSPRNG, hex-encoded. Fixed length, which keeps the compare below simple. */
const TOKEN_BYTES = 32

/** Safe methods never mutate, so they never need a token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Login is necessarily exempt: there is no session yet, so there is no token to have issued.
 *
 * This does leave "login CSRF" open — an attacker forcing a victim's browser to log in as the
 * ATTACKER, so the victim's subsequent work lands in the attacker's account. Mitigating that
 * needs a pre-session token issued to anonymous visitors, which is a larger change and a
 * meaningfully smaller risk for this app (an operator would be looking at an empty desk under a
 * name that is not theirs). Noted rather than silently ignored.
 */
const EXEMPT_PATHS = new Set(['/api/auth/login'])

/**
 * Returns this session's CSRF token, minting one if it has none.
 *
 * Lazily minting matters for the rollout: sessions created before stage 1 shipped have no token,
 * and those users must be able to pick one up from GET /api/auth/me without being forced to sign
 * in again — otherwise stage 3 would log out everyone who happened to hold an older session.
 */
export function issueCsrfToken(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(TOKEN_BYTES).toString('hex')
  }
  return req.session.csrfToken
}

/** Constant-time compare that tolerates a wrong-length or non-hex candidate without throwing. */
function tokensMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(received, 'utf8')
  // timingSafeEqual throws on a length mismatch, which would itself leak length by way of a 500.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function headerToken(req: Request): string | null {
  const raw = req.get(CSRF_HEADER)
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

/**
 * Durably records a mutating request that arrived without a token — see migration 013 for why a
 * log line is not sufficient to gate rollout stage 3.
 *
 * Deliberately swallows every failure. This is diagnostic data: a telemetry write must never be
 * the reason a dealer's trade fails. If the insert errors, the request proceeds and the console
 * warning below is still emitted, so the signal degrades rather than disappearing.
 *
 * Awaited rather than fire-and-forget, because on a serverless runtime work left pending when the
 * response is sent may simply be discarded — an un-awaited promise here would record nothing at
 * exactly the moments it matters. The cost is one round trip, and only on the path that is already
 * the exception rather than the rule.
 */
async function recordMissingToken(req: Request): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO csrf_missing_token (hour, user_id, method, path, count)
       VALUES (date_trunc('hour', now()), $1, $2, $3, 1)
       ON CONFLICT (hour, user_id, method, path)
       DO UPDATE SET count = csrf_missing_token.count + 1, last_seen = now()`,
      [req.session.userId, req.method, req.path],
    )
  } catch (err) {
    console.error('[csrf] could not record a missing-token observation (request still allowed)', err)
  }
}

export async function csrfProtection(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (SAFE_METHODS.has(req.method) || EXEMPT_PATHS.has(req.path)) {
    next()
    return
  }

  // An unauthenticated mutating request has no session to bind a token to; it is going to be
  // rejected by requireAuth/requireAdmin a moment later anyway. Letting it through here keeps the
  // failure a clean 401 rather than a confusing 403 about a token the caller could not have had.
  if (!req.session.userId) {
    next()
    return
  }

  const received = headerToken(req)
  const expected = req.session.csrfToken

  if (received !== null) {
    // Present but wrong is ALWAYS rejected, even in stage 1. Nothing legitimate sends this header
    // yet, so there is no rollout risk in being strict here — and a mismatch is either a bug or an
    // attack, neither of which should be waved through.
    if (!expected || !tokensMatch(expected, received)) {
      res.status(403).json({ error: 'Invalid security token. Reload the page and try again.', code: CSRF_ERROR_CODE })
      return
    }
    next()
    return
  }

  // Absent. Recorded either way — a rejection under enforcement is just as worth seeing as one
  // that was allowed through, and it is the same signal.
  await recordMissingToken(req)

  if (env.csrfEnforce) {
    res.status(403).json({ error: 'Missing security token. Reload the page and try again.', code: CSRF_ERROR_CODE })
    return
  }

  // Kept alongside the durable record: the log is the convenient live view while tailing, the
  // table is what the stage-3 decision is actually made from (see migration 013 — Vercel's runtime
  // logs are deployment-scoped and short-lived, so a quiet log proves nothing on its own).
  console.warn(`[csrf] mutating request with no token: ${req.method} ${req.path} (enforcement off; would be rejected at stage 3)`)
  next()
}
