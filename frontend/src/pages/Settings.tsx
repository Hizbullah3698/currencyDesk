import { useEffect, useState } from 'react'
import { IDLE_WARNING_SECONDS } from '@currencydesk/engine'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { fetchSettings, saveIdleTimeout, type AppSettings } from '@/lib/settings'

/**
 * Admin-only settings. Currently one setting; the page exists because "configurable admin setting"
 * has to mean something an administrator can actually change, and until now every setting in this
 * app lived in the deployment environment where only the hosting account holder could reach it.
 */
export function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [minutes, setMinutes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchSettings().then((s) => {
      if (cancelled) return
      setSettings(s)
      setMinutes(String(s.idleTimeoutMinutes))
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    setError('')
    setSaved(false)
    const n = Number(minutes)
    if (!Number.isInteger(n)) return setError('Enter a whole number of minutes.')
    if (settings && (n < settings.minIdleTimeoutMinutes || n > settings.maxIdleTimeoutMinutes)) {
      return setError(`Enter a value between ${settings.minIdleTimeoutMinutes} and ${settings.maxIdleTimeoutMinutes} minutes.`)
    }
    setBusy(true)
    const res = await saveIdleTimeout(n)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setSettings(res.settings)
    setMinutes(String(res.settings.idleTimeoutMinutes))
    setSaved(true)
  }

  return (
    <div className="max-w-[560px]">
      <h1 className="m-0 mb-[26px] text-heading font-semibold">Settings</h1>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-[13px] py-2.5">
          <div className="text-body font-semibold">Automatic sign-out</div>
          <div className="mt-0.5 text-meta font-normal leading-[1.5] text-muted-60">
            How long a terminal can sit untouched before the session ends. Applies to everyone. A warning appears {IDLE_WARNING_SECONDS} seconds
            beforehand, with the chance to stay signed in.
          </div>
        </div>

        <div className="flex flex-col gap-2.5 p-4">
          <div>
            <label htmlFor="idle-minutes" className="mb-1 block text-meta font-semibold text-muted-70">
              Sign out after
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="idle-minutes"
                type="number"
                value={minutes}
                onChange={(e) => {
                  setMinutes(e.target.value)
                  setSaved(false)
                }}
                disabled={!settings}
                className="tabular h-[34px] w-[110px] text-body"
              />
              <span className="text-body text-muted-70">minutes of inactivity</span>
            </div>
            {settings && (
              <div className="mt-1 text-meta font-normal text-muted-60">
                Between {settings.minIdleTimeoutMinutes} and {settings.maxIdleTimeoutMinutes} minutes.
              </div>
            )}
          </div>

          {error && <div className="text-body font-semibold text-negative">{error}</div>}
          {saved && settings && (
            /* States the propagation delay rather than letting an admin conclude the save was
               ignored when a still-open session keeps the old window for a few more seconds. */
            <div className="text-body font-normal text-positive-text">
              Saved. New sign-ins use this immediately; sessions already open pick it up within {settings.cacheTtlSeconds} seconds.
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="primary" onClick={save} disabled={busy || !settings}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
