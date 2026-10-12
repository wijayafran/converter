import type { HTMLAttributes, ReactNode } from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { cn } from '@/lib/cn'

const alertVariants = cva(
  'relative flex gap-3 w-full rounded-md border p-4 text-sm',
  {
    variants: {
      variant: {
        default: 'bg-background border-border',
        info: 'bg-muted/40 border-border',
        success:
          'border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5 text-[hsl(var(--success))]',
        warning:
          'border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5 text-[hsl(var(--warning-foreground))]',
        destructive:
          'border-[hsl(var(--destructive))]/30 bg-[hsl(var(--destructive))]/5 text-[hsl(var(--destructive))]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const iconFor = {
  default: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: AlertCircle,
} as const

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  icon?: ReactNode
}

export function Alert({
  className,
  variant = 'default',
  icon,
  children,
  ...props
}: AlertProps) {
  const Icon = iconFor[variant ?? 'default']
  return (
    <div className={cn(alertVariants({ variant }), className)} {...props}>
      <div className="pt-0.5">{icon ?? <Icon className="h-4 w-4" />}</div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

export function AlertTitle({ children }: { children: ReactNode }) {
  return <div className="mb-1 font-medium leading-none">{children}</div>
}

export function AlertDescription({ children }: { children: ReactNode }) {
  return <div className="text-sm opacity-90 leading-relaxed">{children}</div>
}
