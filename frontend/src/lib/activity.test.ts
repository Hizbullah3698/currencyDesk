import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { activityTransport, lastActivity, markActivity, markServerContact, needsKeepalive, onActivity, receiveActivityMessage, resetActivity } from './activity'

// The keepalive is the piece that keeps the client countdown and the server session window from
// drifting apart. The server expires a session a fixed period after the last REQUEST, so a user
// who is plainly present — reading a long ledger, moving the mouse — but making no requests would
// otherwise watch the client timer sit happily full while the server session quietly lapsed
// underneath them, and discover it only when their next click failed.
describe('activity tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetActivity()
  })
  afterEach(() => vi.useRealTimers())

  it('records the moment of the last activity', () => {
    const before = lastActivity()
    vi.advanceTimersByTime(5_000)
    markActivity()
    expect(lastActivity()).toBeGreaterThan(before)
  })

  it('notifies subscribers, and stops after unsubscribe', () => {
    let calls = 0
    const off = onActivity(() => calls++)
    markActivity()
    markActivity()
    expect(calls).toBe(2)
    off()
    markActivity()
    expect(calls, 'no further calls once unsubscribed').toBe(2)
  })
})

describe('server keepalive throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetActivity()
  })
  afterEach(() => vi.useRealTimers())

  it('does not want a keepalive immediately after contact', () => {
    expect(needsKeepalive()).toBe(false)
  })

  it('wants one once the interval has elapsed with no requests', () => {
    vi.advanceTimersByTime(61_000)
    expect(needsKeepalive()).toBe(true)
  })

  it('is satisfied by ordinary app traffic, not only by a dedicated ping', () => {
    // The load-bearing case. Every real request calls markServerContact, so a busy user never
    // triggers an extra keepalive on top of the traffic they are already generating — the
    // keepalive exists only for the "present but silent" case.
    vi.advanceTimersByTime(61_000)
    expect(needsKeepalive()).toBe(true)

    markServerContact()
    expect(needsKeepalive()).toBe(false)

    vi.advanceTimersByTime(30_000)
    expect(needsKeepalive(), 'half an interval later, still not due').toBe(false)
  })

  it('local activity alone does NOT satisfy it — that is the whole point', () => {
    // markActivity resets the idle countdown but must not pretend the server was contacted, or
    // the two clocks would drift apart exactly when it matters.
    vi.advanceTimersByTime(61_000)
    markActivity()
    expect(needsKeepalive()).toBe(true)
  })
})

// Signing out destroys the SERVER session, which every tab shares — so the countdown that triggers
// it cannot be per-tab. A second tab left open on a dashboard used to reach its own timeout after
// five quiet minutes and sign out the tab someone was actively dealing in. These cover the merge
// rule that fixes it; the transport that carries the message is exercised by the two-tab run in a
// real browser, since this suite has no window (node environment, no jsdom).
describe('cross-tab activity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetActivity()
  })
  afterEach(() => vi.useRealTimers())

  it('has no transport under the test environment, and degrades to per-tab behaviour', () => {
    // Guarded on `window` at module load, so importing this file never opens a channel or holds
    // the test process open.
    expect(activityTransport()).toBe('none')
  })

  it("adopts another tab's newer activity, so an active tab keeps this one alive", () => {
    const mine = lastActivity()
    vi.advanceTimersByTime(120_000)
    receiveActivityMessage({ at: Date.now(), server: Date.now() })
    expect(lastActivity(), "the peer's timestamp becomes ours").toBeGreaterThan(mine)
  })

  it('notifies subscribers on a peer message, so the countdown UI resets too', () => {
    let calls = 0
    const off = onActivity(() => calls++)
    vi.advanceTimersByTime(5_000)
    receiveActivityMessage({ at: Date.now(), server: Date.now() })
    expect(calls).toBe(1)
    off()
  })

  it('never moves the window backwards on a stale or out-of-order message', () => {
    markActivity()
    const current = lastActivity()
    receiveActivityMessage({ at: current - 60_000, server: current - 60_000 })
    expect(lastActivity(), 'an older timestamp loses').toBe(current)
  })

  it("counts a peer's request as server contact, so both tabs do not send keepalives", () => {
    vi.advanceTimersByTime(61_000)
    expect(needsKeepalive()).toBe(true)
    receiveActivityMessage({ at: Date.now(), server: Date.now() })
    expect(needsKeepalive(), "the other tab's traffic already moved the rolling window").toBe(false)
  })

  it('ignores a malformed message rather than corrupting the window', () => {
    markActivity()
    const current = lastActivity()
    receiveActivityMessage({ at: NaN, server: NaN } as { at: number; server: number })
    receiveActivityMessage(undefined as unknown as { at: number; server: number })
    expect(lastActivity()).toBe(current)
  })
})
