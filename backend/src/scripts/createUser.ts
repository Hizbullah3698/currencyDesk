import { createUser } from '../services/userService.js'
import { hashPassword, MIN_PASSWORD_LENGTH } from '../services/authService.js'
import { pool } from '../db/pool.js'
import { arg } from './lib/args.js'

async function run() {
  const email = arg('email')
  const password = arg('password')
  const name = arg('name')
  const role = arg('role') === 'admin' ? 'admin' : arg('role') === 'user' ? 'user' : undefined
  // Optional: an account with no username is still perfectly valid and signs in by email.
  // One can be added later with `npm run set-username`.
  const username = arg('username')

  if (!email || !password || !name || !role) {
    console.error('Usage: npm run create-user -- --email a@b.com --password "secret123" --role admin --name "Jane Doe" [--username jane]')
    process.exitCode = 1
    return
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    process.exitCode = 1
    return
  }

  const user = await createUser({ email, username, passwordHash: hashPassword(password), displayName: name, role })
  if (!user) {
    console.log(`A user with email "${email}" already exists — no changes made.`)
  } else {
    console.log(`Created ${role} user ${user.email}${user.username ? ` (signs in as "${user.username}")` : ''} — ${user.display_name}.`)
  }
  await pool.end()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
