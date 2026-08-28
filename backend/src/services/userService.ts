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
 */
/**
 * Safety net for the window between deploying this code and running migration 011.
 * Nothing runs migrations automatically on deploy (backend/vercel.json only builds
 * the engine), so a deploy can legitimately land before the `username` column
 * exists. Without this guard the login query would raise 42703 (undefined_column)
 * and EVERY login — including by email — would fail with a 500.
 *
 * Instead we fall back to the email-only lookup that worked before, so the worst
 * case is "username login isn't live yet" rather than "nobody can sign in".
 * Cached per process; a deploy (which follows running the migration anyway) clears
 * it. Delete this once production is known to be migrated.
 */
let hasUsernameColumn = true

export async function findUserByIdentifier(identifier: string): Promise<UserRow | null> {
  if (hasUsernameColumn) {
    try {
      const { rows } = await pool.query<UserRow>(
        'SELECT * FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1)',
        [identifier],
      )
      return rows[0] || null
    } catch (err) {
      if ((err as { code?: string }).code !== '42703') throw err
      hasUsernameColumn = false
      console.warn('[auth] users.username is missing — run migration 011. Falling back to email-only login.')
    }
  }

  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [identifier])
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
