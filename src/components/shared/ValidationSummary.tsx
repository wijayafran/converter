import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { ValidationIssue } from '@/types'

interface Props {
  totalRecords: number
  issues: ValidationIssue[]
}

export function ValidationSummary({ totalRecords, issues }: Props) {
  const blocked = new Set(
    issues
      .filter((i) => i.severity === 'BLOCKED' && i.decision !== 'exclude')
      .map((i) => i.rowIndex),
  ).size
  const warning = new Set(
    issues
      .filter(
        (i) =>
          i.severity === 'WARNING' && i.decision !== 'approve' && i.decision !== 'exclude',
      )
      .map((i) => i.rowIndex),
  ).size
  const valid = Math.max(0, totalRecords - blocked - warning)

  const cards: Array<{
    label: string
    value: number
    tone: 'success' | 'warning' | 'destructive' | 'neutral'
    icon: React.ReactNode
    desc: string
  }> = [
    {
      label: 'Total records',
      value: totalRecords,
      tone: 'neutral',
      icon: <CheckCircle2 className="h-4 w-4 opacity-60" />,
      desc: 'Jumlah baris yang terbaca dari file.',
    },
    {
      label: 'Valid',
      value: valid,
      tone: 'success',
      icon: <CheckCircle2 className="h-4 w-4" />,
      desc: 'Dapat langsung dimigrasikan.',
    },
    {
      label: 'Perlu review',
      value: warning,
      tone: 'warning',
      icon: <AlertTriangle className="h-4 w-4" />,
      desc: 'Peringatan yang bisa diputuskan user.',
    },
    {
      label: 'Terblokir',
      value: blocked,
      tone: 'destructive',
      icon: <AlertCircle className="h-4 w-4" />,
      desc: 'Harus diperbaiki atau dikecualikan.',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-border bg-background p-4"
        >
          <div
            className={`mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider ${
              c.tone === 'success'
                ? 'text-[hsl(var(--success))]'
                : c.tone === 'warning'
                  ? 'text-[hsl(var(--warning))]'
                  : c.tone === 'destructive'
                    ? 'text-[hsl(var(--destructive))]'
                    : 'text-muted-foreground'
            }`}
          >
            {c.icon}
            {c.label}
          </div>
          <p className="text-2xl font-semibold">{c.value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{c.desc}</p>
        </div>
      ))}
    </div>
  )
}
