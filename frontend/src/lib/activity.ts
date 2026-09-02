// ---------------------------------------------------------------------------
// Activity signal — feeds the idle timeout (see useIdleTimeout.ts)
// ---------------------------------------------------------------------------
//
// A tiny module holding state and nothing else, so both the DOM listeners in the hook and the API
// layer in store.tsx/authClient.ts can report activity without either importing the other. Same
// shape as csrf.ts, and for the same reason: it avoids an import cycle between the store and the
// auth layer.
//
// Why API calls count as activity at all, when a request is not a person: a long report render, a
// slow save, or a background refetch all happen because someone asked for them. Counting only
// mouse and keyboard would start the countdown during the very operation the user is waiting on.

let lastActivityAt = Date.now()
const listeners = new Set<() => void>()

function notifyListeners(): void {
  for (const fn of listeners) fn()
}

/** Records activity. Cheap enough to call from a mousemove handler. */
export function markActivity(): void {
  lastActivityAt = Date.now()
  notifyListeners()
  publish()
}

export function lastActivity(): number {
  return lastActivityAt
}

/** Subscribe to activity. Returns an unsubscribe, for use in a React effect cleanup. */
export function onActivity(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ---------------------------------------------------------------------------
// Server keepalive
// ---------------------------------------------------------------------------
// The server expires a session a fixed period after the LAST REQUEST (express-session's
// `rolling`). Mouse and keyboard activity produce no request, so a user reading a long report and
// moving the mouse for six minutes would keep the client timer alive while the server session
// quietly lapsed underneath them — and their next click would fail as unauthenticated despite the
// app showing no warning at all.
//
// So genuine local activity has to touch the server occasionally. Throttled hard, because the
// point is to keep the session warm, not to poll: at most one request per interval, and only when
// something actually happened.
const KEEPALIVE_INTERVAL_MS = 60_000
let lastServerContactAt = Date.now()

/** Called by the API layer whenever a real request goes out, so a keepalive is never sent
 *  redundantly alongside traffic the app was already making. */
export function markServerContact(): void {
  lastServerContactAt = Date.now()
  publish()
}

export function needsKeepalive(now = Date.now()): boolean {
  return now - lastServerContactAt >= KEEPALIVE_INTERVAL_MS
}

export function resetActivity(): void {
  lastActivityAt = Date.now()
  lastServerContactAt = Date.now()
  publish()
}

// ---------------------------------------------------------------------------
// Cross-tab sync
// ---------------------------------------------------------------------------
//
// The state above used to be per-tab, while the thing it controls — sign-out — is emphatically
// not: logging out destroys the SERVER session, which every tab shares. So a second tab left open
// on a dashboard reached its idle timeout after five quiet minutes and signed out the tab someone
// was actively dealing in, mid-form, with no warning. The user's own workaround for the 401 bug
// ("open it again in a new tab") left one of these behind every time.
//
// The fix is to make "last activity" a property of the SESSION rather than of a tab: every tab
// publishes its activity, every tab takes the newest timestamp it has seen from anyone, and the
// countdown each tab runs is therefore against the whole session's idle time. An active tab keeps
// every other tab alive, and only a session that is genuinely idle everywhere reaches zero — at
// which point all remaining tabs agree it has, which is the correct outcome rather than a race.
//
// TRANSPORT — BroadcastChannel first, localStorage second:
//   - BroadcastChannel is the right tool: same-origin pub/sub between tabs, in memory, nothing
//     persisted, and it never fires in the tab that posted. Available everywhere this app runs
//     (Chrome 54+, Firefox 38+, Safari 15.4+).
//   - The fallback covers Safari before 15.4 and any context where the constructor throws. It
//     writes a timestamp to localStorage; other tabs receive it via the `storage` event, which —
//     usefully — also only fires in OTHER tabs, so the semantics match exactly.
//   - If neither is available (or storage is blocked, as in some privacy modes) the app degrades
//     to exactly the old per-tab behaviour rather than breaking. Every access is guarded.
//
// WHY A SECOND localStorage KEY EXISTS: this app deliberately kept localStorage to one key
// (`currencydesk.theme.v1`, a display preference), because business data belongs to Postgres and
// nothing else should look like a client-side source of truth. This key is neither business data
// nor a preference — it is a transport, a single number, written only on the fallback path, and
// nothing reads it as state: a tab merges it into memory and never trusts it beyond the current
// idle window. It is also self-correcting, since a stale value only ever loses to a newer one.
// Keep it that way. Anything that needs to *persist* still belongs on the server.

const CHANNEL_NAME = 'currencydesk.activity.v1'
/** Fallback transport only. See the note above before adding a third key. */
const STORAGE_KEY = 'currencydesk.activity.v1'

/** At most one message per second per tab: this rides on mousemove, and the window it protects is
 *  minutes long, so sub-second precision buys nothing and would put a message on every frame. */
const PUBLISH_THROTTLE_MS = 1000

export type ActivityTransport = 'broadcast-channel' | 'storage' | 'none'

interface ActivityMessage {
  /** Newest local activity in the sending tab. */
  at: number
  /** Newest server contact in the sending tab — its requests moved the rolling window for us too. */
  server: number
}

let transport: ActivityTransport = 'none'
let channel: BroadcastChannel | null = null
let lastPublishedAt = 0

/**
 * Merge a peer tab's timestamps into ours.
 *
 * Exported for tests, and deliberately the ONLY way an inbound message reaches this module's
 * state: it must never route through markActivity(), which publishes — two tabs would then echo
 * each other's activity back and forth and neither would ever go idle.
 *
 * Monotonic on purpose: only newer timestamps are taken, so an out-of-order or stale message
 * cannot pull the window backwards.
 */
export function receiveActivityMessage(msg: ActivityMessage): void {
  if (typeof msg?.at === 'number' && msg.at > lastActivityAt) {
    lastActivityAt = msg.at
    notifyListeners()
  }
  if (typeof msg?.server === 'number' && msg.server > lastServerContactAt) {
    lastServerContactAt = msg.server
  }
}

function publish(): void {
  if (transport === 'none') return
  const now = Date.now()
  if (now - lastPublishedAt < PUBLISH_THROTTLE_MS) return
  lastPublishedAt = now
  const msg: ActivityMessage = { at: lastActivityAt, server: lastServerContactAt }
  try {
    if (transport === 'broadcast-channel') channel?.postMessage(msg)
    // The value has to differ every time or the storage event does not fire; it always does here,
    // since `at` is a timestamp that has just moved.
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(msg))
  } catch {
    // A tab closing mid-post, or storage becoming unavailable (quota, privacy mode). Losing one
    // heartbeat is harmless — the next one is at most a second away.
  }
}

function parse(raw: string | null): ActivityMessage | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed?.at === 'number' ? (parsed as ActivityMessage) : null
  } catch {
    return null
  }
}

/** Chosen transport, for diagnostics and tests. */
export function activityTransport(): ActivityTransport {
  return transport
}

// Set up at module load, guarded on `window` so this file stays importable under the node test
// environment (no jsdom here — see vitest.config.ts) and so nothing holds the test process open.
if (typeof window !== 'undefined') {
  try {
    if (typeof BroadcastChannel === 'function') {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.onmessage = (event: MessageEvent) => receiveActivityMessage(event.data as ActivityMessage)
      transport = 'broadcast-channel'
    }
  } catch {
    channel = null
  }
  if (transport === 'none') {
    try {
      // Probe rather than assume: localStorage exists but throws on access in some privacy modes.
      window.localStorage.getItem(STORAGE_KEY)
      window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY) return
        const msg = parse(event.newValue)
        if (msg) receiveActivityMessage(msg)
      })
      transport = 'storage'
    } catch {
      transport = 'none'
    }
  }
}
