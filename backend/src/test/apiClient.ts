export interface ApiResult<T = any> {
  status: number
  json: T
}

/** A tiny cookie-aware fetch wrapper — real HTTP requests against a real running server,
 * carrying the session cookie the same way a browser would (no supertest, no mocking). */
export class ApiClient {
  private cookie = ''

  constructor(private readonly baseUrl: string) {}

  async login(email: string, password: string): Promise<ApiResult> {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) this.cookie = setCookie.split(';')[0]
    return { status: res.status, json: await res.json().catch(() => null) }
  }

  async get<T = any>(path: string): Promise<ApiResult<T>> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: { Cookie: this.cookie } })
    return { status: res.status, json: await res.json().catch(() => null) }
  }

  async post<T = any>(path: string, body?: unknown): Promise<ApiResult<T>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: this.cookie },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  }

  /** Clones this client's session cookie into a fresh ApiClient — used when a test needs two
   * independent HTTP requests that both authenticate as the same logged-in user (mirrors two
   * browser tabs sharing one session, which is exactly the scenario the concurrency guards on
   * these endpoints exist to handle). */
  withSameSession(): ApiClient {
    const clone = new ApiClient(this.baseUrl)
    clone.cookie = this.cookie
    return clone
  }
}
