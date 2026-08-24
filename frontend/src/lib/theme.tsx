import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'

// Deliberately its own key, not part of currencydesk.state.v1 — a display
// preference is not business data, so it has no reason to live anywhere near
// the pristine/mutate() system that protects real user-entered records.
const THEME_KEY = 'currencydesk.theme.v1'

function loadThemePref(): ThemePref {
  try {
    const raw = window.localStorage.getItem(THEME_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    /* ignore */
  }
  return 'system'
}

interface ThemeCtx {
  theme: ThemePref
  setTheme: (t: ThemePref) => void
}

const Ctx = createContext<ThemeCtx | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePref>(() => loadThemePref())

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      window.localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore quota errors */
    }
  }, [theme])

  const setTheme = (t: ThemePref) => setThemeState(t)

  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
