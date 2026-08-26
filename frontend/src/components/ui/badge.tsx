import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold leading-normal whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-sunken text-muted-70 border border-border',
        positive: 'bg-positive-bg text-positive border border-positive-border',
        negative: 'bg-negative-bg text-negative border border-negative-border',
        pending: 'bg-pending-bg text-pending border border-pending-border',
        accent: 'bg-accent-bg text-accent border border-accent-border',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
)

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />
}
