import { Download, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { MigrationResultSummary } from '@/types'
import { downloadJson } from '@/lib/download'

interface Props {
  result: MigrationResultSummary
  onStartOver: () => void
}

export function MigrationResult({ result, onStartOver }: Props) {
  const cards: Array<{
    label: string
    value: string
    tone?: 'success' | 'warning' | 'destructive' | 'neutral'
  }> = [
    { label: 'Job ID', value: result.jobId },
    { label: 'Destination', value: result.destinationLabel },
    {
      label: 'Started',
      value: new Date(result.startedAt).toLocaleString('id-ID'),
    },
    {
      label: 'Finished',
      value: new Date(result.finishedAt).toLocaleString('id-ID'),
    },
  ]

  const stats: Array<{ label: string; value: number; tone: string }> = [
    {
      label: 'Total records',
      value: result.totalRecords,
      tone: 'text-foreground',
    },
    {
      label: 'Successful (simulated)',
      value: result.successful,
      tone: 'text-[hsl(var(--success))]',
    },
    {
      label: 'Failed',
      value: result.failed,
      tone: 'text-[hsl(var(--destructive))]',
    },
    {
      label: 'Skipped',
      value: result.skipped,
      tone: 'text-muted-foreground',
    },
    {
      label: 'Pending (blocked)',
      value: result.pending,
      tone: 'text-[hsl(var(--warning))]',
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <Alert variant="warning">
        <AlertTitle>Simulated result</AlertTitle>
        <AlertDescription>
          Phase 1 tidak melakukan penulisan ke sistem tujuan. Semua angka di
          bawah ini merupakan hasil simulasi berdasarkan keputusan user.
        </AlertDescription>
      </Alert>

      <div className="rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
          <div>
            <p className="text-sm font-medium">Migration summary</p>
            <p className="text-xs text-muted-foreground">
              Simpan laporan ini untuk audit internal.
            </p>
          </div>
          <Badge variant="muted">SIMULATED</Badge>
        </div>
        <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => (
            <div key={c.label}>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                {c.label}
              </dt>
              <dd className="mt-1 font-mono text-sm">{c.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-border bg-background p-4"
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {s.label}
            </p>
            <p className={`mt-1 text-2xl font-semibold ${s.tone}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {result.notes.length > 0 && (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4">
          <p className="section-heading mb-2">Catatan</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {result.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() =>
            downloadJson(result, `${result.jobId}-report.json`)
          }
        >
          <Download className="h-4 w-4" />
          Download report
        </Button>
        <Button variant="outline" onClick={onStartOver}>
          <RotateCcw className="h-4 w-4" />
          Mulai migrasi lain
        </Button>
      </div>
    </div>
  )
}
