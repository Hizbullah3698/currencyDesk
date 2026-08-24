import { createUser } from '../services/userService.js'
import { hashPassword } from '../services/authService.js'
import { pool } from '../db/pool.js'

// Zero-arg local-dev convenience: creates two fixed accounts so a developer has working
// logins immediately after `docker compose up` + migrate, without needing a signup flow.
// This is the direct, honest replacement for the old demo build's "any credentials sign in
// as Admin" — real auth, but still one command away from a working login.
const DEMO_USERS = [
  { email: 'admin@currencydesk.local', password: 'admin-demo-pass', displayName: 'Admin User', role: 'admin' as const },
  { email: 'user@currencydesk.local', password: 'user-demo-pass', displayName: 'Operations User', role: 'user' as const },
]

async function run() {
  for (const u of DEMO_USERS) {
    const created = await createUser({ email: u.email, passwordHash: hashPassword(u.password), displayName: u.displayName, role: u.role })
    if (created) {
      console.log(`Created ${u.role} account: ${u.email} / ${u.password}`)
    } else {
      console.log(`Already exists, left unchanged: ${u.email}`)
    }
  }
  await pool.end()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
