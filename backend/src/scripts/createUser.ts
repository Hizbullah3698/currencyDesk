import { createUser } from '../services/userService.js'
import { hashPassword } from '../services/authService.js'
import { pool } from '../db/pool.js'

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
  const name = arg('name')
  const role = arg('role') === 'admin' ? 'admin' : arg('role') === 'user' ? 'user' : undefined

  if (!email || !password || !name || !role) {
    console.error('Usage: npm run create-user -- --email a@b.com --password "secret123" --role admin --name "Jane Doe"')
    process.exitCode = 1
    return
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    process.exitCode = 1
    return
  }

  const user = await createUser({ email, passwordHash: hashPassword(password), displayName: name, role })
  if (!user) {
    console.log(`A user with email "${email}" already exists — no changes made.`)
  } else {
    console.log(`Created ${role} user ${user.email} (${user.display_name}).`)
  }
  await pool.end()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
