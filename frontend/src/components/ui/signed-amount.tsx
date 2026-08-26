import { TrendingUp, TrendingDown } from 'lucide-react'
import { fmt } from '@/lib/format'
import { cn } from '@/lib/utils'

interface SignedAmountProps {
  /** A genuinely signed value — one that can land on either side of zero (a net
   * movement, a margin, a profit/loss line). Not for one-directional balances
   * like a receivable or a daily sales total, which are never negative. */
  value: number
  /** How to render the absolute value — defaults to fmt() (PKR-prefixed). Pass
   * fmtNum (or similar) for contexts that already establish PKR elsewhere and
   * show bare numbers, matching the surrounding cells. */
  format?: (n: number) => string
  className?: string
}

/**
 * Small tinted chip for a signed amount: soft background + full-color icon/text,
 * plus a leading +/- sign, so direction never depends on color alone.
 */
export function SignedAmount({ value, format = fmt, className }: SignedAmountProps) {
  if (!value) {
    return <span className={cn('tabular font-medium text-muted-60', className)}>{format(0)}</span>
  }
  const positive = value > 0
  const Icon = positive ? TrendingUp : TrendingDown
  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 font-semibold',
        positive ? 'bg-positive-bg text-positive-text' : 'bg-negative-bg text-negative-deep',
        className,
      )}
    >
      <Icon size={11} strokeWidth={2.6} aria-hidden="true" />
      {positive ? '+' : '−'}
      {format(Math.abs(value))}
    </span>
  )
}
