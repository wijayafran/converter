import { MigrationResult } from '@/components/shared/MigrationResult'
import { EmptyState } from '@/components/shared/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import type { MigrationResultSummary } from '@/types'
import type { RunManifest, RunProgress } from '@/lib/batch'

interface Props {
  result: MigrationResultSummary | null
  progress: RunProgress | null
  manifest: RunManifest<unknown> | null
  onStartOver: () => void
}

export function ResultStep({ result, progress, manifest, onStartOver }: Props) {
  if (!result && progress && progress.phase !== 'completed') {
    const pct = progress.totalBatches
      ? Math.min(
          100,
          Math.round((progress.batchesCompleted / progress.totalBatches) * 100),
        )
      : 0
    return (
      <div className="flex flex-col gap-6">
        <Alert variant="info">
          <AlertTitle>MOCK batch engine · {progress.phase}</AlertTitle>
          <AlertDescription>
            Batch {progress.batchesCompleted}/{progress.totalBatches} —
            {' '}inserted {progress.recordsInserted} ·
            {' '}skipped {progress.recordsSkipped} ·
            {' '}failed {progress.recordsFailed} ·
            {' '}conflict {progress.recordsConflict}
          </AlertDescription>
        </Alert>
        <Progress value={pct} />
      </div>
    )
  }
  if (!result) {
    return (
      <EmptyState
        title="Belum ada hasil"
        description="Selesaikan preview & confirm untuk menjalankan batch engine."
      />
    )
  }
  return (
    <div className="flex flex-col gap-6">
      <MigrationResult result={result} onStartOver={onStartOver} />
      {manifest && (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4">
          <p className="section-heading mb-2">Recovery manifest</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>runId: <code className="font-mono">{manifest.runId}</code></li>
            <li>batches: {manifest.batches.length}</li>
            <li>idempotency hashes: {manifest.idempotencyHashes.length}</li>
            <li>retry queue: {manifest.retryQueue.length}</li>
            <li>mode: {manifest.mode}</li>
          </ul>
        </div>
      )}
    </div>
  )
}
