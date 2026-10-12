import { AlertTriangle, CheckCircle2, HelpCircle, Puzzle } from 'lucide-react'
import type { MappingSummary } from '@/lib/mapping'

interface Props {
  summary: MappingSummary
}

const Card = ({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode
  label: string
  value: number
  tone?: 'default' | 'warning' | 'destructive' | 'success'
}) => {
  const toneClass =
    tone === 'warning'
      ? 'text-[hsl(var(--warning))]'
      : tone === 'destructive'
        ? 'text-[hsl(var(--destructive))]'
        : tone === 'success'
          ? 'text-[hsl(var(--success))]'
          : 'text-foreground'
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className={`mb-2 flex items-center gap-2 ${toneClass}`}>
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  )
}

export function MappingSummaryCards({ summary }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Card
        icon={<CheckCircle2 className="h-4 w-4" />}
        label="Terpetakan"
        value={summary.matched}
        tone="success"
      />
      <Card
        icon={<AlertTriangle className="h-4 w-4" />}
        label="Wajib · Hilang"
        value={summary.requiredMissing}
        tone={summary.requiredMissing > 0 ? 'destructive' : 'default'}
      />
      <Card
        icon={<HelpCircle className="h-4 w-4" />}
        label="Opsional · Hilang"
        value={summary.optionalMissing}
        tone={summary.optionalMissing > 0 ? 'warning' : 'default'}
      />
      <Card
        icon={<Puzzle className="h-4 w-4" />}
        label="Kolom ekstra"
        value={summary.extraSource}
      />
    </div>
  )
}
