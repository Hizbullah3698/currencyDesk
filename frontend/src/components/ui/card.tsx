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
        'rounded-panel shadow-xs transition-shadow duration-150',
        variant === 'bordered' ? 'border border-border bg-surface' : 'border-0 bg-surface-tint',
        className,
      )}
      {...props}
    />
  )
}
