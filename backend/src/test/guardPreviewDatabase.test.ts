import { describe, it, expect } from 'vitest'
import { assertPreviewDatabaseIsIsolated } from '../config/guardPreviewDatabase.js'

// The tripwire that stops preview deployments booting against the live database.
//
// Preview deployments are disabled at the Vercel project level, which is the actual fix. This
// guard exists because that is a dashboard toggle — one click from coming back, with nothing in
// the repository to notice. These tests are what make the guard itself trustworthy: a guard whose
// only trigger is an import side effect never gets exercised, and then it is wrong when it matters.
describe('preview database guard', () => {
  const guard = (vercelEnv: string | undefined, previewDbIsolated?: string) => () =>
    assertPreviewDatabaseIsIsolated({ vercelEnv, previewDbIsolated })

  it('refuses a preview deployment that has not declared its database isolated', () => {
    // The exact state that existed until 2026-09-03: DATABASE_URL scoped to "Production, Preview",
    // so a preview booted straight against the live books.
    expect(guard('preview')).toThrow(/Refusing to start/i)
    expect(guard('preview')).toThrow(/PREVIEW_DB_ISOLATED/)
  })

  it('says what to actually do, not just that it refused', () => {
    // An error a reader cannot act on gets worked around rather than understood — and the
    // workaround here is setting a flag without moving the database, which is the worst outcome.
    expect(guard('preview')).toThrow(/Neon branch/i)
    expect(guard('preview')).toThrow(/Setting the flag without moving the database/i)
  })

  it('allows a preview that has declared its database isolated', () => {
    expect(guard('preview', 'true')).not.toThrow()
  })

  it('never interferes with production', () => {
    // Production shares no code path with the preview case, but asserting it means a future
    // tightening of this guard cannot take the live site down as a side effect.
    expect(guard('production')).not.toThrow()
    expect(guard('production', undefined)).not.toThrow()
  })

  it('never interferes with local development or tests', () => {
    // VERCEL_ENV is set only by Vercel. Everywhere else it is absent and the guard is a no-op.
    expect(guard(undefined)).not.toThrow()
    expect(guard('development')).not.toThrow()
  })

  it('treats anything other than the exact string "true" as not isolated', () => {
    // Same convention as csrfEnforce, and for the same reason — but note the safe side is the
    // opposite one here. A typo in the CSRF flag fails open so the desk keeps working; a typo in
    // this one must fail CLOSED, because the cost of guessing wrong is writing to the real books.
    for (const value of ['TRUE', 'True', '1', 'yes', 'true ', '', 'false']) {
      expect(guard('preview', value), `"${value}" must not count as isolated`).toThrow(/Refusing to start/i)
    }
  })
})
