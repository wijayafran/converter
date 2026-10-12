import type { ReactNode } from 'react'
import { AlertTriangle, Inbox } from 'lucide-react'

interface EmptyProps {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}

export function EmptyState({ title, description, action, icon }: EmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
      <div className="rounded-full border border-border bg-background p-3 text-muted-foreground">
        {icon ?? <Inbox className="h-5 w-5" />}
      </div>
      <h3 className="text-sm font-medium">{title}</h3>
      {description && (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  )
}

interface ErrorProps {
  title: string
  message: string
  action?: ReactNode
}

export function ErrorState({ title, message, action }: ErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/5 px-6 py-10 text-center text-[hsl(var(--destructive))]">
      <AlertTriangle className="h-5 w-5" />
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="max-w-md text-sm opacity-90">{message}</p>
      {action}
    </div>
  )
}
