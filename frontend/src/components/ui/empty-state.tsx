import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { CATEGORY_COLORS, type Category } from '@/lib/ui-helpers'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  category,
  className,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
  title: string
  description?: string
  action?: ReactNode
  /**
   * Ties the empty state to the section it belongs to, using the same soft
   * icon-badge tint the sidebar and stat tiles already use for that category
   * (Salary reads violet, Cheques amber, Customers teal, and so on). Omit it
   * only where the surface genuinely has no category — a mixed, all-types feed
   * like Dashboard's recent activity — which then falls back to the neutral
   * grey chip. This is the existing category system, not a new colour: an empty
   * screen is the one moment a user has no data to orient them, so carrying the
   * section's own identity is doing real work rather than decorating.
   */
  category?: Category
  className?: string
}) {
  const cat = CATEGORY_COLORS[category ?? 'neutral']
  return (
    <div className={cn('flex flex-col items-center gap-2.5 py-10 text-center', className)}>
      <span
        className="flex h-9 w-9 flex-none items-center justify-center rounded-panel"
        style={{ background: cat.bg, color: cat.color }}
        aria-hidden="true"
      >
        <Icon size={18} strokeWidth={1.9} />
      </span>
      <div className={cn('text-body text-muted-60', description || action ? 'font-semibold' : 'font-normal')}>{title}</div>
      {description && <div className="max-w-[320px] text-body font-normal text-muted-60">{description}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
