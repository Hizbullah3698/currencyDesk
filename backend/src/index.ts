import { createApp } from './app.js'
import { env } from './config/env.js'

const app = createApp()

app.listen(env.port, () => {
  console.log(`Currency Desk auth server listening on http://localhost:${env.port} (${env.nodeEnv})`)
})
