import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type TabsCtx = {
  value: string
  setValue: (v: string) => void
}

const Ctx = createContext<TabsCtx | null>(null)

export function Tabs({
  defaultValue,
  value: controlledValue,
  onValueChange,
  children,
  className,
}: {
  defaultValue?: string
  value?: string
  onValueChange?: (v: string) => void
  children: ReactNode
  className?: string
}) {
  const [internal, setInternal] = useState(defaultValue ?? '')
  const value = controlledValue ?? internal
  const setValue = (v: string) => {
    if (controlledValue === undefined) setInternal(v)
    onValueChange?.(v)
  }
  return (
    <Ctx.Provider value={{ value, setValue }}>
      <div className={cn('flex flex-col gap-4', className)}>{children}</div>
    </Ctx.Provider>
  )
}

export function TabsList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'inline-flex h-9 items-center gap-1 rounded-md bg-muted p-1 text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function TabsTrigger({
  value,
  children,
  className,
}: {
  value: string
  children: ReactNode
  className?: string
}) {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('TabsTrigger must be inside Tabs')
  const isActive = ctx.value === value
  return (
    <button
      type="button"
      onClick={() => ctx.setValue(value)}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded px-3 py-1 text-sm font-medium transition-all',
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string
  children: ReactNode
  className?: string
}) {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('TabsContent must be inside Tabs')
  if (ctx.value !== value) return null
  return <div className={className}>{children}</div>
}
