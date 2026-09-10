import { useEffect, useState } from 'react'

/**
 * True once the app has finished its one bootstrap step this hook is
 * responsible for — web fonts loading (Instrument Sans / IBM Plex Mono, pulled
 * from Google Fonts in index.css) — subject to a floor so it never flashes for a
 * cached repeat visit, and a ceiling so a slow/unsupported font-loading API can't
 * hang the UI.
 *
 * The business-data fetch is NOT covered here. `store.tsx` loads the snapshot
 * from `GET /api/state` and `App.tsx`'s Gate() shows its own loading screen while
 * that is in flight; this hook only gates the per-screen skeletons that depend on
 * the fonts being measured. The two are deliberately separate concerns.
 */
export function useBootReady(floorMs = 220, ceilingMs = 900): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const start = Date.now()
    const finish = () => {
      if (cancelled) return
      const elapsed = Date.now() - start
      const remaining = Math.max(floorMs - elapsed, 0)
      window.setTimeout(() => !cancelled && setReady(true), remaining)
    }
    const ceiling = window.setTimeout(finish, ceilingMs)
    const fontsReady = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready
    if (fontsReady) fontsReady.then(() => { window.clearTimeout(ceiling); finish() })
    else finish()
    return () => {
      cancelled = true
      window.clearTimeout(ceiling)
    }
  }, [floorMs, ceilingMs])

  return ready
}
