import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import * as authClient from './authClient'
import type { SessionUser } from './authClient'

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous' | 'unreachable'

interface AuthCtx {
  status: AuthStatus
  user: SessionUser | null
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [user, setUser] = useState<SessionUser | null>(null)

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

  const ctx: AuthCtx = {
    status,
    user,
    login: async (email, password) => {
      const result = await authClient.login(email, password)
      if (!result.ok) return { ok: false, error: result.error }
      setUser(result.user)
      setStatus('authenticated')
      return { ok: true }
    },
    logout: async () => {
      await authClient.logout()
      setUser(null)
      setStatus('anonymous')
    },
  }

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
