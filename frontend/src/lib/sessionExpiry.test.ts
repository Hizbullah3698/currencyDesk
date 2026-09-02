import { describe, it, expect, beforeEach } from 'vitest'
import { isSessionActive, notifySessionExpired, onSessionExpired, setSessionActive } from './sessionExpiry'

// The signal that turns a 401 into a trip to the login screen. Its whole subtlety is WHEN it is
// allowed to fire: two 401s are completely normal (a signed-out visitor's boot /me, and a mistyped
// password) and neither means "your session ended".
describe('session expiry signal', () => {
  beforeEach(() => setSessionActive(false))

  it('stays silent when no session was ever established', () => {
    // The boot /me of a signed-out visitor, and a failed login, both land here.
    let fired = 0
    const off = onSessionExpired(() => fired++)
    notifySessionExpired()
    expect(fired, 'a 401 with no session behind it is not an expiry').toBe(0)
    off()
  })

  it('fires once a session is active, and reports to every subscriber', () => {
    let a = 0
    let b = 0
    const offA = onSessionExpired(() => a++)
    const offB = onSessionExpired(() => b++)
    setSessionActive(true)
    notifySessionExpired()
    expect([a, b]).toEqual([1, 1])
    offA()
    offB()
  })

  it('disarms itself, so a burst of concurrent 401s signs out once', () => {
    // The load-bearing case: navigating fires a refetch while a mutation is still in flight, so
    // two requests can fail together. Re-entering sign-out for each would be at best wasteful and
    // at worst a second logout POST against a session that is already gone.
    let fired = 0
    const off = onSessionExpired(() => fired++)
    setSessionActive(true)
    notifySessionExpired()
    notifySessionExpired()
    notifySessionExpired()
    expect(fired).toBe(1)
    expect(isSessionActive()).toBe(false)
    off()
  })

  it('stops notifying after unsubscribe', () => {
    let fired = 0
    const off = onSessionExpired(() => fired++)
    off()
    setSessionActive(true)
    notifySessionExpired()
    expect(fired).toBe(0)
  })
})
