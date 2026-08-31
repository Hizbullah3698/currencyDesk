import type { PoolClient } from 'pg'
import { pool } from '../db/pool.js'
import { appError } from './transact.js'

// ---------------------------------------------------------------------------
// Runtime-editable app settings (migration 015)
// ---------------------------------------------------------------------------
// Distinct from config/env.ts, which owns DEPLOYMENT configuration — things only whoever holds
// the hosting account can or should change, and which require a redeploy. This owns settings an
// administrator changes from inside the running app.

export const IDLE_TIMEOUT_KEY = 'idle_timeout_minutes'

/** The client's requested default. Used when the row is absent, so a missing row degrades to a
 *  sensible value rather than to "no timeout at all", which would fail open on a security control. */
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 5

/**
 * Bounds, enforced on write.
 *
 * The lower bound is not arbitrary: the warning modal appears 30 seconds before expiry, so
 * anything under a minute would show a countdown that begins before the user has finished the
 * action that started it. The upper bound keeps this recognisably an *idle* timeout — beyond a
 * working day it stops being a security control and starts being a slow memory leak of live
 * sessions.
 */
export const MIN_IDLE_TIMEOUT_MINUTES = 1
export const MAX_IDLE_TIMEOUT_MINUTES = 480

/**
 * Read-through cache.
 *
 * The idle timeout is consulted on EVERY authenticated request (see
 * middleware/sessionIdleTimeout.ts), and a database round trip per request to Neon — a different
 * continent from the functions — would be a real cost for a value that changes perhaps twice a
 * year. The trade is propagation delay: after an administrator changes it, instances keep serving
 * the old value for up to TTL. That is acceptable for this setting and is stated in the API
 * response so the UI can say so honestly.
 *
 * Per-process, so on serverless each concurrent instance warms its own. `invalidate` clears only
 * the instance that handled the write; the rest expire naturally.
 */
const CACHE_TTL_MS = 30_000
let cached: { minutes: number; at: number } | null = null

export function invalidateSettingsCache(): void {
  cached = null
}

/** Parses and clamps whatever is in the row, so a hand-edited nonsense value cannot disable the
 *  timeout. Anything unparseable falls back to the default rather than to Infinity. */
function coerceMinutes(raw: string | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_IDLE_TIMEOUT_MINUTES
  return Math.min(Math.max(Math.round(n), MIN_IDLE_TIMEOUT_MINUTES), MAX_IDLE_TIMEOUT_MINUTES)
}

export async function getIdleTimeoutMinutes(): Promise<number> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.minutes
  try {
    const { rows } = await pool.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [IDLE_TIMEOUT_KEY])
    const minutes = coerceMinutes(rows[0]?.value)
    cached = { minutes, at: Date.now() }
    return minutes
  } catch (err) {
    // A settings lookup must never be able to take the app down. If the table is missing (code
    // deployed ahead of its migration) or the database is briefly unreachable, fall back to the
    // default rather than failing the request that was only passing through.
    console.error('[settings] could not read the idle timeout, using the default', err)
    return DEFAULT_IDLE_TIMEOUT_MINUTES
  }
}

export async function setIdleTimeoutMinutes(client: PoolClient, minutes: number, actorId: string | null): Promise<void> {
  if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
    throw appError(400, 'Enter the idle timeout as a whole number of minutes.')
  }
  if (minutes < MIN_IDLE_TIMEOUT_MINUTES || minutes > MAX_IDLE_TIMEOUT_MINUTES) {
    throw appError(400, `The idle timeout must be between ${MIN_IDLE_TIMEOUT_MINUTES} and ${MAX_IDLE_TIMEOUT_MINUTES} minutes.`)
  }
  await client.query(
    `INSERT INTO app_settings (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [IDLE_TIMEOUT_KEY, String(minutes), actorId],
  )
  invalidateSettingsCache()
}

export interface PublicSettings {
  idleTimeoutMinutes: number
  /** So the UI can state the delay rather than appearing to have ignored a change. */
  cacheTtlSeconds: number
  minIdleTimeoutMinutes: number
  maxIdleTimeoutMinutes: number
}

export async function getPublicSettings(): Promise<PublicSettings> {
  return {
    idleTimeoutMinutes: await getIdleTimeoutMinutes(),
    cacheTtlSeconds: CACHE_TTL_MS / 1000,
    minIdleTimeoutMinutes: MIN_IDLE_TIMEOUT_MINUTES,
    maxIdleTimeoutMinutes: MAX_IDLE_TIMEOUT_MINUTES,
  }
}
