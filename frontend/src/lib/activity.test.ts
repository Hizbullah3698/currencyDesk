import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { lastActivity, markActivity, markServerContact, needsKeepalive, onActivity, resetActivity } from './activity'

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
