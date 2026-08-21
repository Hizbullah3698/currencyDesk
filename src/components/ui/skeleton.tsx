import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn('animate-pulse rounded-[4px] bg-surface-tint', className)} style={style} aria-hidden="true" />
}

/** Matches the icon-chip + two-line-text + badge + amount shape used across the
 * app's list/table rows (Dashboard recent activity, Customers, Payments, etc.). */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5 border-b border-divider px-[13px] py-2', className)}>
      <Skeleton className="h-5 w-5 flex-none" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3 w-[38%]" />
        <Skeleton className="h-2.5 w-[22%]" />
      </div>
      <Skeleton className="h-4 w-14 flex-none rounded-full" />
      <Skeleton className="h-3 w-16 flex-none" />
    </div>
  )
}
