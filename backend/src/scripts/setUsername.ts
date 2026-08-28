import { setUsernameByEmail } from '../services/userService.js'
import { pool } from '../db/pool.js'

/**
 * Assigns a login username to an existing account, found by its email.
 *
 *   npm run set-username -- --email admin@currencydesk.local --username admin
 *
 * Exists because there is no user-management screen yet: this is the supported way
 * to give an already-created account (including one created before migration 011)
 * a username. Format and uniqueness are enforced by the database, not here, so this
 * cannot introduce a value the login lookup would choke on.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function run() {
  const email = arg('email')
  const username = arg('username')

  if (!email || !username) {
    console.error('Usage: npm run set-username -- --email <email> --username <username>')
    process.exitCode = 1
    return
  }

  try {
    const updated = await setUsernameByEmail(email, username)
    if (!updated) {
      console.error(`No account found with email ${email}`)
      process.exitCode = 1
      return
    }
    console.log(`${updated.email} can now sign in as "${updated.username}" (role: ${updated.role})`)
  } catch (err) {
    const e = err as { code?: string; message: string }
    // 23505 = unique violation (username taken), 23514 = check violation (bad format).
    if (e.code === '23505') console.error(`Username "${username}" is already taken.`)
    else if (e.code === '23514') console.error(`"${username}" is not a valid username — use 3-32 characters: letters, digits, dot, underscore or hyphen, starting and ending with a letter or digit, and no "@".`)
    else console.error(e.message)
    process.exitCode = 1
  }
}

run()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
