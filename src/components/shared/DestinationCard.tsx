import type { LucideIcon } from 'lucide-react'
import { ArrowRight } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface Props {
  icon: LucideIcon
  title: string
  tagline: string
  description: string
  stackLine: string
  onStart: () => void
  disabled?: boolean
}

export function DestinationCard({
  icon: Icon,
  title,
  tagline,
  description,
  stackLine,
  onStart,
  disabled,
}: Props) {
  return (
    <Card className="flex h-full flex-col transition-shadow hover:shadow-md">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="rounded-md border border-border bg-muted/40 p-2.5">
            <Icon className="h-5 w-5" />
          </div>
          <Badge variant="muted">Phase 1 • UI only</Badge>
        </div>
        <CardTitle className="mt-4">{title}</CardTitle>
        <p className="text-sm font-medium text-foreground/80">{tagline}</p>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-4">
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 font-mono text-xs text-muted-foreground">
          {stackLine}
        </div>
        <Button onClick={onStart} disabled={disabled} className="w-full">
          Start Migration
          <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  )
}
