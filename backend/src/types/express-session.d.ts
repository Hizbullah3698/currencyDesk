import 'express-session'

declare module 'express-session' {
  interface SessionData {
    userId?: string
    role?: 'admin' | 'user'
    /** Synchroniser token for CSRF protection — see middleware/csrf.ts. Minted lazily, so a
     *  session predating that middleware picks one up on its next GET /api/auth/me. */
    csrfToken?: string
  }
}
