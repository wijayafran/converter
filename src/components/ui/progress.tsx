import { cn } from '@/lib/cn'

export function Progress({
  value = 0,
  className,
}: {
  value?: number
  className?: string
}) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-full bg-muted',
        className,
      )}
    >
      <div
        className="h-full bg-primary transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
