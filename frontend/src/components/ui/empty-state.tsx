import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 py-10 text-center', className)}>
      <Icon size={20} strokeWidth={1.8} className="text-muted-42" aria-hidden="true" />
      <div className={cn('text-body text-muted-60', description || action ? 'font-semibold' : 'font-normal')}>{title}</div>
      {description && <div className="max-w-[320px] text-body font-normal text-muted-60">{description}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
