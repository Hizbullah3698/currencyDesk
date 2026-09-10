import { pool } from '../db/pool.js'

export interface UserRow {
  id: string
  email: string
  username: string | null
  password_hash: string
  display_name: string
  role: 'admin' | 'user'
  is_active: boolean
}

export interface PublicUser {
  id: string
  email: string
  username: string | null
  displayName: string
  role: 'admin' | 'user'
}

export function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, username: row.username ?? null, displayName: row.display_name, role: row.role }
}

/**
 * Resolves ONE identifier against either column — an account is reachable by its
 * email or by its username, and the caller neither knows nor needs to know which
 * one matched. Deliberately a single query rather than "try email, then try
 * username": two sequential lookups would take measurably longer when the first
 * misses, which is exactly the timing signal the dummy-hash comparison in
 * authService is there to suppress.
 *
 * Migration 011 forbids '@' in a username, so an identifier can never
 * legitimately match an email in one row and a username in another.
 *
 * (This once carried a 42703 fallback to email-only lookup, for the window between
 * deploying this code and running migration 011. Migration 011 has been live in
 * production since August 2026, so the fallback and its per-process flag were
 * removed.)
 */
export async function findUserByIdentifier(identifier: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    'SELECT * FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1)',
    [identifier],
  )
  return rows[0] || null
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id])
  return rows[0] || null
}

export async function touchLastLogin(id: string): Promise<void> {
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [id])
}

export async function createUser(input: {
  email: string
  passwordHash: string
  displayName: string
  role: 'admin' | 'user'
  username?: string | null
}): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (email, username, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (lower(email)) DO NOTHING
     RETURNING *`,
    [input.email, input.username || null, input.passwordHash, input.displayName, input.role],
  )
  return rows[0] || null
}

/**
 * Assigns (or clears) an account's username, looked up by email. Used by the
 * set-username CLI. Returns null when no account has that email; throws on a
 * duplicate username or a format violation, both of which the database enforces.
 */
export async function setUsernameByEmail(email: string, username: string | null): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    'UPDATE users SET username = $1, updated_at = now() WHERE lower(email) = lower($2) RETURNING *',
    [username, email],
  )
  return rows[0] || null
}
