import type { PoolClient } from 'pg'
import { pool } from '../db/pool.js'

export type UserNameMap = Map<string, string>

/**
 * One query, reused across every response-shaping call in a request — this app has a handful
 * of users, so resolving `created_by`/`updated_by` uuids to display names in memory is simpler
 * than repeating a LEFT JOIN on every one of the five business tables.
 */
export async function loadUserNames(client: PoolClient | typeof pool): Promise<UserNameMap> {
  const { rows } = await client.query<{ id: string; display_name: string }>('SELECT id, display_name FROM users')
  return new Map(rows.map((r) => [r.id, r.display_name]))
}

export function resolveActor(id: string | null, names: UserNameMap): string {
  if (!id) return 'System'
  return names.get(id) || 'Unknown user'
}
