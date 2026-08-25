import type { Pool } from 'pg'
import type { Store, Options, ClientRateLimitInfo } from 'express-rate-limit'

/**
 * A Postgres-backed Store for express-rate-limit, replacing the default in-memory one.
 * The in-memory store only counts hits correctly when a single long-lived process holds them —
 * on a serverless deployment, concurrent function instances each get their own separate memory,
 * so the login brute-force limiter would silently undercount instead of erroring. Backing it
 * with the same Postgres database everything else already uses avoids that without adding a new
 * service (e.g. Redis) just for this.
 *
 * The upsert below does the "increment, or reset-and-start-at-1 if the window has elapsed" logic
 * in one atomic statement, so two concurrent requests for the same key can't race each other into
 * an inconsistent count the way a separate read-then-write would.
 */
export class PostgresRateLimitStore implements Store {
  private windowMs = 60_000

  constructor(private readonly pool: Pool) {}

  init(options: Options): void {
    this.windowMs = options.windowMs
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const { rows } = await this.pool.query<{ count: number; reset_at: Date }>(
      `INSERT INTO rate_limit_hits (key, count, reset_at)
       VALUES ($1, 1, now() + ($2 || ' milliseconds')::interval)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limit_hits.reset_at <= now() THEN 1 ELSE rate_limit_hits.count + 1 END,
         reset_at = CASE WHEN rate_limit_hits.reset_at <= now() THEN now() + ($2 || ' milliseconds')::interval ELSE rate_limit_hits.reset_at END
       RETURNING count, reset_at`,
      [key, this.windowMs],
    )
    return { totalHits: rows[0].count, resetTime: rows[0].reset_at }
  }

  async decrement(key: string): Promise<void> {
    await this.pool.query('UPDATE rate_limit_hits SET count = GREATEST(count - 1, 0) WHERE key = $1', [key])
  }

  async resetKey(key: string): Promise<void> {
    await this.pool.query('DELETE FROM rate_limit_hits WHERE key = $1', [key])
  }
}
