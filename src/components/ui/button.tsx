import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white hover:bg-accent-hover',
        secondary: 'bg-surface text-ink border border-border-strong hover:bg-surface-tint',
        ghost: 'text-muted-70 hover:bg-surface-tint hover:text-ink',
        destructive: 'bg-negative text-white hover:brightness-95',
        outlineDestructive: 'bg-surface text-negative-deep border border-negative border-dashed hover:bg-negative-bg',
        link: 'text-accent hover:text-accent-hover underline-offset-2 hover:underline p-0 h-auto',
      },
      size: {
        sm: 'h-7 px-2.5',
        default: 'h-8 px-3.5',
        lg: 'h-9 px-4 text-[13px]',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = 'Button'
