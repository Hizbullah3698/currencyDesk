import bcrypt from 'bcryptjs'
import { findUserByIdentifier, touchLastLogin, toPublicUser, type PublicUser } from './userService.js'

const BCRYPT_COST = 12

// A precomputed hash of a password nobody has, compared against on an unknown-identifier
// login attempt so that "no such account" and "wrong password" take statistically the same
// amount of time — without this, response-time differences would leak which accounts exist.
// This now protects usernames exactly as it already protected emails: the lookup is a single
// query across both columns, so a miss costs the same either way and is followed by the same
// real bcrypt comparison.
const DUMMY_HASH = bcrypt.hashSync('no-such-account-timing-normalizer', BCRYPT_COST)

// One message for every failure mode below — unknown email, unknown username, and wrong
// password are indistinguishable to the caller. Never split this into more specific text
// (e.g. "no such user"): that would hand an attacker a way to enumerate valid login IDs,
// which matters more for short guessable usernames than it ever did for email addresses.
const INVALID_CREDENTIALS = 'Invalid username or password.'

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_COST)
}

export type LoginResult = { ok: true; user: PublicUser } | { ok: false; status: 401 | 403; error: string }

/** `identifier` is either an email address or a username — see findUserByIdentifier. */
export async function attemptLogin(identifier: string, password: string): Promise<LoginResult> {
  const user = await findUserByIdentifier(identifier)

  const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH)

  if (!user || !passwordMatches) {
    return { ok: false, status: 401, error: INVALID_CREDENTIALS }
  }
  if (!user.is_active) {
    return { ok: false, status: 403, error: 'This account has been deactivated.' }
  }

  await touchLastLogin(user.id)
  return { ok: true, user: toPublicUser(user) }
}
