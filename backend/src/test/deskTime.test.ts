import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { parseTxnDate } from '../routes/txnDate.js'
import { isAppError } from '../services/transact.js'

// The server's idea of "today" — AUDIT.md §3 #2.
//
// The desk is in Pakistan (UTC+5). The server runs wherever Vercel puts it, on UTC. Between
// midnight and 05:00 on the desk's clock it is still yesterday on the server's, and every place
// the server derived "today" from its own clock got the desk's day wrong for those five hours:
// the dealer's date picker sends today, and the server refuses it as being in the future.
//
// These tests pin the process to UTC — the production condition, which a developer machine set to
// Asia/Karachi never reproduces — and freeze the clock at 02:30 on the desk's morning.

/** 2026-04-01 02:30 in Karachi, which is still 2026-03-31 21:30 in UTC. */
const DESK_EARLY_MORNING = new Date('2026-03-31T21:30:00.000Z')
const DESK_TODAY = '2026-04-01'
const SERVER_TODAY_UTC = '2026-03-31'

describe('"today" on the server is the desk\'s day, not the host\'s', () => {
  let originalTz: string | undefined

  beforeAll(() => {
    originalTz = process.env.TZ
    // Node re-reads TZ at runtime, so the rest of this file runs as production does.
    process.env.TZ = 'UTC'
    // Prove the pin took, or every assertion below is measuring the developer's own timezone.
    expect(new Date(2026, 0, 1).getTimezoneOffset(), 'process must be in UTC for this file').toBe(0)
  })

  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts a deal dated on the desk\'s today at 02:30 local, when it is still yesterday in UTC', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(DESK_EARLY_MORNING)
    expect(new Date().toISOString().slice(0, 10), 'the host thinks it is still yesterday').toBe(SERVER_TODAY_UTC)

    // The dealer's date picker defaulted to today — the desk's today.
    expect(parseTxnDate(DESK_TODAY)).toBe(DESK_TODAY)
  })

  it('still refuses a date that is genuinely in the future on the desk\'s clock', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(DESK_EARLY_MORNING)

    let caught: unknown
    try {
      parseTxnDate('2026-04-02')
    } catch (err) {
      caught = err
    }
    expect(isAppError(caught) && caught.status).toBe(400)
    expect(isAppError(caught) && caught.message).toMatch(/cannot be in the future/)
  })

  it('still validates the calendar without the host timezone leaking in', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(DESK_EARLY_MORNING)
    expect(() => parseTxnDate('2026-02-30')).toThrow(/not a real calendar date/)
    expect(parseTxnDate('2026-02-28')).toBe('2026-02-28')
    expect(parseTxnDate('')).toBeNull()
  })
})
