import { useNavigate } from 'react-router-dom'
import { useStore } from '@/lib/store'

export function Denied({ label }: { label: string }) {
  const { setRole } = useStore()
  const navigate = useNavigate()

  return (
    <div className="mt-12 max-w-[520px] rounded-[8px] border border-border bg-surface p-[22px]">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c4443a" strokeWidth="2" className="mb-[11px] block">
        <rect x="4" y="11" width="16" height="10" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <h1 className="m-0 mb-[5px] text-[17px] font-semibold tracking-tight">Admin access required</h1>
      <div className="text-[12.5px] leading-relaxed text-muted-70">
        You're viewing as Operations user. {label} is restricted to Admin accounts — switch roles from the top bar,
        or use the shortcut below.
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => setRole('admin')}
          className="rounded-[6px] border border-accent bg-accent px-3 py-[7px] text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          Switch to Admin
        </button>
        <button
          onClick={() => navigate('/dashboard')}
          className="rounded-[6px] border border-border-input bg-surface px-3 py-[7px] text-[12.5px] font-semibold text-ink transition-colors hover:bg-surface-tint"
        >
          Back to Overview
        </button>
      </div>
    </div>
  )
}
