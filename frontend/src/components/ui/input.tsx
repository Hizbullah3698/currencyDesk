import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-8 w-full rounded-[6px] border border-border-strong bg-surface px-2.5 text-body text-ink placeholder:text-muted-60/70 transition-colors duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-muted-60',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-[6px] border border-border-strong bg-surface px-2.5 py-2 text-body text-ink placeholder:text-muted-60/70',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1 block text-meta font-semibold uppercase tracking-wide text-muted-60', className)}
      {...props}
    />
  )
}
