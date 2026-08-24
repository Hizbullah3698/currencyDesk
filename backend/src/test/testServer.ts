import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from '../app.js'

export interface TestServer {
  baseUrl: string
  close: () => Promise<void>
}

/** Boots a real Express app (same `createApp()` production uses) on an ephemeral port, so
 * integration tests exercise real HTTP + real middleware + a real session cookie round-trip
 * rather than calling service functions directly. */
export async function startTestServer(): Promise<TestServer> {
  const app = createApp()
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  }
}
