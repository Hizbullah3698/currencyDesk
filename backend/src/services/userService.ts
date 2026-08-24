import { pool } from '../db/pool.js'

export interface UserRow {
  id: string
  email: string
  password_hash: string
  display_name: string
  role: 'admin' | 'user'
  is_active: boolean
}

export interface PublicUser {
  id: string
  email: string
  displayName: string
  role: 'admin' | 'user'
}

export function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role }
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email])
  return rows[0] || null
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id])
  return rows[0] || null
}

export async function touchLastLogin(id: string): Promise<void> {
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [id])
}

export async function createUser(input: { email: string; passwordHash: string; displayName: string; role: 'admin' | 'user' }): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (email, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (lower(email)) DO NOTHING
     RETURNING *`,
    [input.email, input.passwordHash, input.displayName, input.role],
  )
  return rows[0] || null
}
