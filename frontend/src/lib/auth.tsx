import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import * as authClient from './authClient'
import type { SessionUser } from './authClient'
import { onSessionExpired, setSessionActive } from './sessionExpiry'

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous' | 'unreachable'

interface AuthCtx {
  status: AuthStatus
  user: SessionUser | null
  /** True when the last sign-out was the session ending on its own, not the user asking to leave.
   *  Drives the message on the login screen; cleared by a successful sign-in. */
  sessionEnded: boolean
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  /** `expired: true` marks a sign-out the user did not ask for — the idle window elapsing. */
  logout: (opts?: { expired?: boolean }) => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [user, setUser] = useState<SessionUser | null>(null)
  const [sessionEnded, setSessionEnded] = useState(false)

  // The one call that makes "reload keeps you logged in" work: the browser sends the httpOnly
  // session cookie automatically, so a valid existing session resolves straight to
  // 'authenticated' with no credentials re-entered.
  useEffect(() => {
    let cancelled = false
    authClient.me().then((result) => {
      if (cancelled) return
      if (result.status === 'authenticated') {
        setUser(result.user)
        setStatus('authenticated')
      } else {
        setUser(null)
        setStatus(result.status)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Identity used to be resolved once, here, and never revisited — which is what turned an expired
  // session into a permanent "Couldn't load your data: Not authenticated." screen instead of a trip
  // back to sign-in. The API layers now raise a signal on any 401 from an established session, and
  // this is where the app acts on it. Subscribing rather than polling: the trigger is a real server
  // response, so there is nothing to poll for.
  useEffect(() => {
    return onSessionExpired(() => {
      setUser(null)
      setStatus('anonymous')
      setSessionEnded(true)
    })
  }, [])

  // Kept in step with `status`, so a 401 is only ever read as an expiry when a session actually
  // existed. Without this, the boot /me of a signed-out visitor and a mistyped password would both
  // announce that a session had ended.
  useEffect(() => {
    setSessionActive(status === 'authenticated')
  }, [status])

  const ctx: AuthCtx = {
    status,
    user,
    sessionEnded,
    login: async (email, password) => {
      const result = await authClient.login(email, password)
      if (!result.ok) return { ok: false, error: result.error }
      setUser(result.user)
      setStatus('authenticated')
      setSessionEnded(false)
      return { ok: true }
    },
    logout: async (opts) => {
      await authClient.logout()
      setUser(null)
      setStatus('anonymous')
      setSessionEnded(!!opts?.expired)
    },
  }

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
