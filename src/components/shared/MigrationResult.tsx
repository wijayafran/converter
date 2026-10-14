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
  const isLive = result.mode === 'SQL_LOCAL_TEST'
  const counts = result.counts

  const header: Array<{
    label: string
    value: string
  }> = [
    { label: 'Job ID', value: result.jobId },
    { label: 'Destination', value: result.destinationLabel },
    { label: 'Mode', value: result.modeLabel },
    {
      label: 'Started',
      value: new Date(result.startedAt).toLocaleString('id-ID'),
    },
    {
      label: 'Finished',
      value: new Date(result.finishedAt).toLocaleString('id-ID'),
    },
  ]

  // Full count chain exposed as its own grid so a non-technical reviewer can
  // see where every record ended up.
  const chainTone = (v: number, kind: 'success' | 'warn' | 'muted' | 'destructive') => {
    if (v === 0) return 'text-muted-foreground'
    if (kind === 'success') return 'text-[hsl(var(--success))]'
    if (kind === 'warn') return 'text-[hsl(var(--warning))]'
    if (kind === 'destructive') return 'text-[hsl(var(--destructive))]'
    return 'text-foreground'
  }

  const chain: Array<{
    label: string
    value: number
    tone: string
    hint: string
  }> = [
    {
      label: 'Source records',
      value: counts.source,
      tone: 'text-foreground',
      hint: 'Rows read from the uploaded Excel.',
    },
    {
      label: 'Excluded (user)',
      value: counts.excluded,
      tone: chainTone(counts.excluded, 'muted'),
      hint: 'Rows the user explicitly removed in Review.',
    },
    {
      label: 'Blocked (validation)',
      value: counts.blocked,
      tone: chainTone(counts.blocked, 'destructive'),
      hint: 'Rows that failed structural rules and cannot be executed.',
    },
    {
      label: 'Eligible',
      value: counts.eligible,
      tone: 'text-foreground',
      hint: 'Rows that would be sent to the batch runner.',
    },
    {
      label: 'Attempted',
      value: counts.attempted,
      tone: 'text-foreground',
      hint: 'Rows the adapter actually tried to insert.',
    },
    {
      label: 'Inserted',
      value: counts.inserted,
      tone: chainTone(counts.inserted, isLive ? 'success' : 'muted'),
      hint: isLive
        ? 'Rows the adapter reports as inserted (pre-verification).'
        : 'Dry Run never inserts — this count is zero by design.',
    },
    {
      label: 'Skipped',
      value: counts.skipped,
      tone: chainTone(counts.skipped, 'muted'),
      hint: 'Adapter-refused rows (e.g. DRY_RUN=true).',
    },
    {
      label: 'Failed',
      value: counts.failed,
      tone: chainTone(counts.failed, 'destructive'),
      hint: 'Rows that errored (SQL error, timeout, …).',
    },
    {
      label: 'Conflicts (idempotent)',
      value: counts.conflicts,
      tone: chainTone(counts.conflicts, 'warn'),
      hint: 'Rows whose PK already existed (safe to re-run).',
    },
    {
      label: 'Verified (read-back)',
      value: counts.verified ?? 0,
      tone:
        counts.verified === null
          ? 'text-muted-foreground'
          : chainTone(counts.verified, 'success'),
      hint: isLive
        ? 'Rows confirmed by a post-insert SELECT. This is the confirmed-success metric.'
        : 'Not applicable in Dry Run.',
    },
  ]

  const chainConsistent =
    counts.attempted ===
    counts.inserted + counts.skipped + counts.failed + counts.conflicts
  const insertVerifiedMatch =
    counts.verified === null || counts.verified === counts.inserted

  return (
    <div className="flex flex-col gap-6">
      <Alert variant={isLive ? 'info' : 'warning'}>
        <AlertTitle>
          {isLive
            ? 'SQL Local Test — local database result'
            : `${result.modeLabel} — no database writes`}
        </AlertTitle>
        <AlertDescription>
          {isLive
            ? `Rows below were inserted into dev_analytic_cxlite.analytic_leads_sales on the local lemons-mssql container and verified via a read-back SELECT. The confirmed-success metric is "Verified (read-back)" — not "Inserted". The eventlog table was not written to. No production system was contacted.`
            : 'No database writes occurred. All counts are reporting-only; Inserted and Verified are 0 by design for this mode.'}
        </AlertDescription>
      </Alert>

      <div className="rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
          <div>
            <p className="text-sm font-medium">Migration summary</p>
            <p className="text-xs text-muted-foreground">
              Simpan laporan ini untuk audit internal. Attribution comes from
              THIS run — pre-existing database rows are not claimed as
              inserts.
            </p>
          </div>
          <Badge variant="muted">{result.modeLabel}</Badge>
        </div>
        <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
          {header.map((c) => (
            <div key={c.label}>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                {c.label}
              </dt>
              <dd className="mt-1 font-mono text-sm">{c.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <p className="section-heading mb-2">Record flow</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {chain.map((s) => (
            <div
              key={s.label}
              className="rounded-lg border border-border bg-background p-4"
              title={s.hint}
            >
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {s.label}
              </p>
              <p className={`mt-1 text-2xl font-semibold ${s.tone}`}>
                {s.value}
              </p>
            </div>
          ))}
        </div>
        {(!chainConsistent || !insertVerifiedMatch) && (
          <Alert variant="warning" className="mt-3">
            <AlertTitle>Chain inconsistency</AlertTitle>
            <AlertDescription>
              {!chainConsistent &&
                `Attempted (${counts.attempted}) ≠ inserted + skipped + failed + conflicts (${
                  counts.inserted + counts.skipped + counts.failed + counts.conflicts
                }). `}
              {!insertVerifiedMatch &&
                `Inserted (${counts.inserted}) ≠ verified (${counts.verified}).`}
            </AlertDescription>
          </Alert>
        )}
      </div>

      {result.batches.length > 0 && (
        <div>
          <p className="section-heading mb-2">Per-batch breakdown</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Batch</th>
                  <th className="px-3 py-2 font-medium">Attempted</th>
                  <th className="px-3 py-2 font-medium">Inserted</th>
                  <th className="px-3 py-2 font-medium">Skipped</th>
                  <th className="px-3 py-2 font-medium">Failed</th>
                  <th className="px-3 py-2 font-medium">Conflicts</th>
                  <th className="px-3 py-2 font-medium">Inserted IDs (sample)</th>
                </tr>
              </thead>
              <tbody>
                {result.batches.map((b) => (
                  <tr key={b.batchId} className="border-t border-border">
                    <td className="px-3 py-2 font-mono">{b.batchId}</td>
                    <td className="px-3 py-2">{b.attempted}</td>
                    <td className="px-3 py-2">{b.inserted}</td>
                    <td className="px-3 py-2">{b.skipped}</td>
                    <td className="px-3 py-2">{b.failed}</td>
                    <td className="px-3 py-2">{b.conflicts}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {b.insertedIds.slice(0, 3).join(', ')}
                      {b.insertedIds.length > 3
                        ? ` …+${b.insertedIds.length - 3}`
                        : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
