import { useState } from 'react'
import { useStore } from '@/lib/store'

export function Login() {
  const { login } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-5 py-10">
      <div className="w-full max-w-[372px]">
        <div className="mb-5 flex items-center gap-2.5">
          <svg width="22" height="22" viewBox="0 0 20 20" fill="none" className="block flex-none">
            <path d="M2.5 6.5h13l-3-3" stroke="#3d46d0" strokeWidth="1.8" strokeLinecap="square" />
            <path d="M17.5 13.5h-13l3 3" stroke="#3d46d0" strokeWidth="1.8" strokeLinecap="square" />
          </svg>
          <div className="text-[15px] font-semibold tracking-tight">Currency Desk</div>
        </div>

        <div className="rounded-[8px] border border-border bg-surface p-[22px]">
          <h1 className="m-0 mb-[3px] text-[16px] font-semibold tracking-tight">Sign in</h1>
          <div className="mb-[18px] text-[12px] text-muted-60">Use your desk account to continue.</div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              login('admin')
            }}
          >
            <label className="mb-[5px] block text-[11px] font-semibold uppercase tracking-wide text-muted-60">Email or username</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@currencydesk.pk"
              className="mb-[13px] h-[34px] w-full rounded-[6px] border border-border-input bg-surface px-2.5 text-[13px] text-ink"
            />

            <label className="mb-[5px] block text-[11px] font-semibold uppercase tracking-wide text-muted-60">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mb-4 h-[34px] w-full rounded-[6px] border border-border-input bg-surface px-2.5 text-[13px] text-ink"
            />

            <button type="submit" className="w-full rounded-[6px] border border-accent bg-accent px-3 py-[9px] text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover">
              Login
            </button>
          </form>

          <div className="my-[17px] flex items-center gap-2.5">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-60">Demo access</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="flex gap-2">
            <button onClick={() => login('admin')} className="flex-1 rounded-[6px] border border-border-input bg-surface px-2.5 py-2 text-[12.5px] font-semibold text-ink transition-colors hover:bg-surface-tint">
              Continue as Admin
            </button>
            <button onClick={() => login('user')} className="flex-1 rounded-[6px] border border-border-input bg-surface px-2.5 py-2 text-[12.5px] font-semibold text-ink transition-colors hover:bg-surface-tint">
              Continue as User
            </button>
          </div>
          <div className="mt-2.5 text-[11px] leading-relaxed text-muted-60">
            Presentation build — any credentials sign in as Admin. The demo buttons set the role directly.
          </div>
        </div>
      </div>
    </div>
  )
}
