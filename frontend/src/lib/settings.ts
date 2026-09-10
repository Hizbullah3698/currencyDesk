import {
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  MIN_IDLE_TIMEOUT_MINUTES,
  MAX_IDLE_TIMEOUT_MINUTES,
  SETTINGS_CACHE_TTL_SECONDS,
} from '@currencydesk/engine'
import { apiUrl } from './apiBase'
import { requestHeaders } from './csrf'
import { markServerContact } from './activity'
import { notifySessionExpired } from './sessionExpiry'

/**
 * App-level settings an administrator can change at runtime, as opposed to the deployment
 * configuration in the backend's environment (see backend/src/services/settingsService.ts).
 */
export interface AppSettings {
  idleTimeoutMinutes: number
  /** The server caches this value briefly, so a change takes up to this long to reach every
   *  instance. Surfaced so the settings screen can say so rather than looking broken. */
  cacheTtlSeconds: number
  minIdleTimeoutMinutes: number
  maxIdleTimeoutMinutes: number
}

/**
 * The fallback used until the real value arrives, and if it never does.
 *
 * It errs on the side of *having* a timeout: a failed settings fetch that left the timeout
 * undefined would silently disable an access control on a machine sitting on a shop counter,
 * which is the wrong way for this to fail. The numbers come from `@currencydesk/engine` — the
 * same source the backend serves and clamps against — so this cannot quietly assert a bound the
 * server no longer honours.
 */
export const FALLBACK_SETTINGS: AppSettings = {
  idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
  cacheTtlSeconds: SETTINGS_CACHE_TTL_SECONDS,
  minIdleTimeoutMinutes: MIN_IDLE_TIMEOUT_MINUTES,
  maxIdleTimeoutMinutes: MAX_IDLE_TIMEOUT_MINUTES,
}

async function parseJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export async function fetchSettings(): Promise<AppSettings> {
  try {
    markServerContact()
    const res = await fetch(apiUrl('/api/settings'), { credentials: 'include' })
    // Falling back silently on a 401 would leave the app running the DEFAULT idle window against
    // a session that no longer exists — a countdown for a session that already ended.
    if (res.status === 401) notifySessionExpired()
    if (!res.ok) return FALLBACK_SETTINGS
    const body = await parseJson(res)
    return {
      idleTimeoutMinutes: Number(body?.idleTimeoutMinutes) || FALLBACK_SETTINGS.idleTimeoutMinutes,
      cacheTtlSeconds: Number(body?.cacheTtlSeconds) || FALLBACK_SETTINGS.cacheTtlSeconds,
      minIdleTimeoutMinutes: Number(body?.minIdleTimeoutMinutes) || FALLBACK_SETTINGS.minIdleTimeoutMinutes,
      maxIdleTimeoutMinutes: Number(body?.maxIdleTimeoutMinutes) || FALLBACK_SETTINGS.maxIdleTimeoutMinutes,
    }
  } catch {
    return FALLBACK_SETTINGS
  }
}

export async function saveIdleTimeout(minutes: number): Promise<{ ok: true; settings: AppSettings } | { ok: false; error: string }> {
  try {
    markServerContact()
    const res = await fetch(apiUrl('/api/settings'), {
      method: 'PATCH',
      headers: requestHeaders('PATCH'),
      credentials: 'include',
      body: JSON.stringify({ idleTimeoutMinutes: minutes }),
    })
    const body = await parseJson(res)
    if (res.status === 401) notifySessionExpired()
    if (!res.ok) return { ok: false, error: body?.error || 'Could not reach the server.' }
    return { ok: true, settings: body as AppSettings }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}
