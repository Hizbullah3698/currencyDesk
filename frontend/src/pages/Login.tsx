import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Logo } from '@/components/layout/Logo'

export function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    const result = await login(email, password)
    if (!result.ok) setError(result.error || 'Sign in failed.')
    setSubmitting(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-5 py-10">
      <div className="w-full max-w-[372px]">
        <div className="mb-5 flex items-center gap-2.5">
          <Logo size={22} />
          <div className="text-[15px] font-semibold tracking-tight">Currency Desk</div>
        </div>

        <Card className="p-[22px] shadow-md">
          <h1 className="m-0 mb-[3px] text-[16px] font-semibold tracking-tight">Sign in</h1>
          <div className="mb-[18px] text-[12px] font-normal text-muted-60">Use your desk account to continue.</div>

          <form onSubmit={onSubmit}>
            <label className="mb-[5px] block text-[11px] font-semibold uppercase tracking-wide text-muted-60">Email or username</label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@currencydesk.pk"
              autoComplete="username"
              className="mb-[13px] h-[34px] text-[13px]"
            />

            <label className="mb-[5px] block text-[11px] font-semibold uppercase tracking-wide text-muted-60">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="mb-4 h-[34px] text-[13px]"
            />

            {error && <div className="mb-3 text-[11.5px] font-medium text-negative-text">{error}</div>}

            <Button type="submit" variant="primary" disabled={submitting} className="w-full py-[9px] text-[13px]">
              {submitting ? 'Signing in…' : 'Login'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
