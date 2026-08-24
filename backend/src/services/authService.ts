import bcrypt from 'bcryptjs'
import { findUserByEmail, touchLastLogin, toPublicUser, type PublicUser } from './userService.js'

const BCRYPT_COST = 12

// A precomputed hash of a password nobody has, compared against on an unknown-email login
// attempt so that "email not found" and "wrong password" take statistically the same amount
// of time — without this, response-time differences would leak which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('no-such-account-timing-normalizer', BCRYPT_COST)

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_COST)
}

export type LoginResult = { ok: true; user: PublicUser } | { ok: false; status: 401 | 403; error: string }

export async function attemptLogin(email: string, password: string): Promise<LoginResult> {
  const user = await findUserByEmail(email)

  const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH)

  if (!user || !passwordMatches) {
    return { ok: false, status: 401, error: 'Invalid email or password.' }
  }
  if (!user.is_active) {
    return { ok: false, status: 403, error: 'This account has been deactivated.' }
  }

  await touchLastLogin(user.id)
  return { ok: true, user: toPublicUser(user) }
}
