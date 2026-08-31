import { hashPassword } from '../services/authService.js'
import { pool } from '../db/pool.js'

/**
 * Resets an existing account's password, found by email.
 *
 *   npm run set-password -- --email user@example.com --password "newsecret1"
 *
 * Exists because bcrypt is one-way: a forgotten password can only be replaced,
 * never recovered, and there is no self-service reset or user-management screen
 * yet. Hashes with the same cost-12 bcrypt the login path verifies against, so a
 * password set here behaves identically to one set at account creation.
 */
const MIN_PASSWORD_LENGTH = 8

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  const inline = process.argv.find((a) => a.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]
  return undefined
}

async function run() {
  const email = arg('email')
  const password = arg('password')

  if (!email || !password) {
    console.error('Usage: npm run set-password -- --email <email> --password "<newPassword>"')
    process.exitCode = 1
    return
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    process.exitCode = 1
    return
  }

  const { rows } = await pool.query(
    'UPDATE users SET password_hash = $1, updated_at = now() WHERE lower(email) = lower($2) RETURNING email, username, role',
    [hashPassword(password), email],
  )
  if (!rows[0]) {
    console.error(`No account found with email ${email}`)
    process.exitCode = 1
    return
  }
  console.log(`Password updated for ${rows[0].email} (username: ${rows[0].username ?? 'none'}, role: ${rows[0].role})`)
}

run()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
