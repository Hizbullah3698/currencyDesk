import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export function Denied({ label }: { label: string }) {
  const navigate = useNavigate()

  return (
    <Card variant="flat" className="mt-12 max-w-[520px] p-[22px]">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-negative)" strokeWidth="2" className="mb-[11px] block" aria-hidden="true">
        <rect x="4" y="11" width="16" height="10" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <h1 className="m-0 mb-[5px] text-heading font-semibold tracking-tight">Admin access required</h1>
      <div className="text-body font-normal leading-relaxed text-muted-70">
        You're signed in as an Operations user. {label} is restricted to Admin accounts — sign in with an admin
        account to continue.
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={() => navigate('/dashboard')}>
          Back to Overview
        </Button>
      </div>
    </Card>
  )
}
