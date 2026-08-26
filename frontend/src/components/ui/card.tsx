import * as React from 'react'
import { cn } from '@/lib/utils'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 'bordered' (default): the usual boxed card. 'flat': no border, a subtly
   * tinted background instead — for stat/summary panels that don't need a hard
   * edge, keeping borders reserved for cards that genuinely separate a distinct
   * section (data tables, forms). */
  variant?: 'bordered' | 'flat'
}

export function Card({ className, variant = 'bordered', ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[8px] shadow-xs transition-shadow duration-150',
        variant === 'bordered' ? 'border border-border bg-surface' : 'border-0 bg-surface-tint',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5', className)} {...props} />
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-meta font-semibold uppercase tracking-wide text-muted-60', className)} {...props} />
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 pb-4', className)} {...props} />
}
