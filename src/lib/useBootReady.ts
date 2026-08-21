import { useEffect, useState } from 'react'

/**
 * True once the app has actually finished its one real asynchronous bootstrap
 * step — web fonts loading (Instrument Sans / IBM Plex Mono, pulled from Google
 * Fonts in index.css) — subject to a floor so it never flashes for a cached
 * repeat visit, and a ceiling so a slow/unsupported font-loading API can't hang
 * the UI. There's no data-fetch latency in this app (the store hydrates
 * synchronously from localStorage), so this intentionally does not pretend one
 * exists — it covers the one bootstrap gap that's real.
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
