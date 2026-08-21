import { useState } from 'react'
import { useStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Logo } from '@/components/layout/Logo'

export function Login() {
  const { login } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

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

          <form
            onSubmit={(e) => {
              e.preventDefault()
              login('admin')
            }}
          >
            <label className="mb-[5px] block text-[11px] font-semibold uppercase tracking-wide text-muted-60">Email or username</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@currencydesk.pk" className="mb-[13px] h-[34px] text-[13px]" />

            <label className="mb-[5px] block text-[11px] font-semibold uppercase tracking-wide text-muted-60">Password</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="mb-4 h-[34px] text-[13px]" />

            <Button type="submit" variant="primary" className="w-full py-[9px] text-[13px]">
              Login
            </Button>
          </form>

          <div className="my-[17px] flex items-center gap-2.5">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-60">Demo access</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1 py-2 text-[12.5px]" onClick={() => login('admin')}>
              Continue as Admin
            </Button>
            <Button variant="secondary" className="flex-1 py-2 text-[12.5px]" onClick={() => login('user')}>
              Continue as User
            </Button>
          </div>
          <div className="mt-2.5 text-[11px] font-normal leading-relaxed text-muted-60">
            Presentation build — any credentials sign in as Admin. The demo buttons set the role directly.
          </div>
        </Card>
      </div>
    </div>
  )
}
