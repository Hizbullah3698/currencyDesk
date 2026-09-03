// ---------------------------------------------------------------------------
// Refuse to boot a preview deployment that has not declared its database isolated
// ---------------------------------------------------------------------------
//
// THE FAULT THIS EXISTS TO STOP. Until 2026-09-03 the backend's DATABASE_URL was a single Vercel
// variable scoped to "Production, Preview" — one value, both environments — so every preview
// deployment booted against the live Neon database with full write access. Anything recorded
// through a preview address was a real entry in the real books, made by unreviewed code.
//
// That is now closed at the platform level by turning preview deployments off. This guard exists
// because that is a dashboard toggle: one click away from coming back, with nothing in the
// repository to notice. A preview environment variable re-added by someone who does not know this
// history would silently re-arm the whole thing. Code survives where a setting does not.
//
// SAME SHAPE AS test/guardTestDatabase.ts, and for the same reason. That guard was written after a
// stray `vitest run` truncated the dev database for real; this one is written before the equivalent
// accident rather than after, because the accident here writes to the live books rather than a dev
// copy.
//
// WHAT IT DOES AND DOES NOT PROVE. It is a tripwire, not a verification. It cannot tell a Neon
// preview branch from the production database by looking at a URL — the honest signal for that is
// a human saying so. So a preview deployment must carry PREVIEW_DB_ISOLATED=true, scoped to the
// Preview environment alone, and setting it is an assertion that the preview DATABASE_URL points
// somewhere that is not production. What the guard guarantees is that nobody re-enables previews
// against the live database *by accident*: re-adding DATABASE_URL to Preview is no longer enough on
// its own, and the second, deliberate step is where the thought happens.
//
// Local development and tests are unaffected — VERCEL_ENV is set only by Vercel, so the condition
// below is false everywhere else.

export interface PreviewGuardEnv {
  /** Vercel sets this to 'production' | 'preview' | 'development'. Undefined off-platform. */
  vercelEnv: string | undefined
  /** Whether a human has declared this preview's database to be isolated from production. */
  previewDbIsolated: string | undefined
}

/**
 * Throws if this is a preview deployment whose database has not been declared isolated.
 *
 * Exported separately from the module-level call at the bottom so it can be tested directly:
 * a guard whose only trigger is an import side effect cannot be exercised without loading the
 * whole app, which is how such guards end up untested and then wrong.
 */
export function assertPreviewDatabaseIsIsolated(env: PreviewGuardEnv): void {
  if (env.vercelEnv !== 'preview') return
  // Exactly 'true', matching how csrfEnforce reads its flag — a typo fails to the safe side, which
  // here means refusing to boot rather than booting against production.
  if (env.previewDbIsolated === 'true') return

  throw new Error(
    'Refusing to start: this is a Vercel PREVIEW deployment and PREVIEW_DB_ISOLATED is not "true". ' +
      'Preview deployments used to share the production DATABASE_URL, so anything recorded through ' +
      'a preview address was written to the real books. Preview deployments are disabled at the ' +
      'project level for that reason. If you are deliberately re-enabling them, point the Preview ' +
      'environment\'s DATABASE_URL at its own Neon branch first, then set PREVIEW_DB_ISOLATED=true ' +
      'scoped to Preview only. Setting the flag without moving the database defeats the guard and ' +
      'puts live customer records behind unreviewed code.',
  )
}

assertPreviewDatabaseIsIsolated({
  vercelEnv: process.env.VERCEL_ENV?.trim(),
  previewDbIsolated: process.env.PREVIEW_DB_ISOLATED?.trim(),
})
