/**
 * Batch execution engine.
 *
 * The engine is destination-agnostic — it takes any `DestinationAdapter<R>`
 * and a flat array of records (SqlRecord or CosmosWritable). Responsibilities:
 *
 *   - Chunk records into fixed-size batches.
 *   - Execute batches sequentially (default) with pause/resume/cancel.
 *   - Call `prepareBatch` → `insertBatch` → optional `reconcile` for each.
 *   - Track per-record outcome and surface a retry queue of failed rows.
 *   - Collect a recovery manifest with batch IDs, hashes, and reconcile
 *     reports so a reviewer can roll back or restart.
 *
 * The engine does NOT fabricate success. If the adapter reports `simulated:
 * true` (MOCK/DRY_RUN), every entry in the manifest is tagged accordingly
 * and the UI must label the result as MOCK.
 */

import { newRunId } from '@/lib/transform/identifiers'
import type { AdapterRollbackPreview } from '@/lib/adapters/types'
import type {
  BatchRunHandle,
  BatchRunnerOptions,
  RunManifest,
  RunPhase,
  RunProgress,
} from './types'

const DEFAULT_BATCH_SIZE = 500
const DEFAULT_PAUSE_MS = 0

export function createBatchRunner<R>(
  options: BatchRunnerOptions<R>,
): BatchRunHandle<R> {
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE)
  const pauseBetween = Math.max(0, options.pauseBetweenBatchesMs ?? DEFAULT_PAUSE_MS)
  const runId = options.runId ?? newRunId('RUN')
  const totalBatches = Math.ceil(options.records.length / batchSize)

  const progress: RunProgress = {
    runId,
    phase: 'idle',
    totalRecords: options.records.length,
    totalBatches,
    batchesCompleted: 0,
    recordsAttempted: 0,
    recordsInserted: 0,
    recordsSkipped: 0,
    recordsFailed: 0,
    recordsConflict: 0,
    startedAt: null,
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    mode: options.adapter.mode,
    activeBatchId: null,
    errors: [],
  }

  const manifest: RunManifest<R> = {
    runId,
    destination: options.destination,
    mode: options.adapter.mode,
    totalRecords: options.records.length,
    batchSize,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    batches: [],
    retryQueue: [],
    idempotencyHashes: [],
  }

  let cancelled = false
  let paused = false
  let resumeSignal: (() => void) | null = null
  let completionResolve: ((m: RunManifest<R>) => void) | null = null
  let completionReject: ((err: Error) => void) | null = null
  const completion = new Promise<RunManifest<R>>((resolve, reject) => {
    completionResolve = resolve
    completionReject = reject
  })

  function setPhase(phase: RunPhase) {
    progress.phase = phase
    progress.updatedAt = new Date().toISOString()
    options.onProgress?.({ ...progress })
  }

  async function waitIfPaused() {
    if (!paused) return
    setPhase('paused')
    await new Promise<void>((resolve) => {
      resumeSignal = resolve
    })
    setPhase('running')
  }

  async function run(): Promise<RunManifest<R>> {
    try {
      setPhase('preparing')
      progress.startedAt = new Date().toISOString()
      const probe = await options.adapter.validateConnection()
      if (!probe.ok) {
        throw new Error(`Adapter failed validateConnection: ${probe.notes.join(' / ')}`)
      }
      setPhase('running')
      for (let i = 0; i < totalBatches; i++) {
        if (cancelled) {
          setPhase('cancelled')
          finalize('cancelled')
          return manifest
        }
        await waitIfPaused()
        const slice = options.records.slice(i * batchSize, (i + 1) * batchSize)
        const prepared = await options.adapter.prepareBatch({
          runId,
          batchIndex: i,
          records: slice,
        })
        progress.activeBatchId = prepared.batchId
        const batchResult = await options.adapter.insertBatch(prepared)
        progress.recordsAttempted += slice.length
        progress.recordsInserted += batchResult.inserted
        progress.recordsSkipped += batchResult.skipped
        progress.recordsFailed += batchResult.failed
        progress.recordsConflict += batchResult.conflicts
        for (const r of batchResult.perRecord) {
          if (r.status === 'failed') {
            manifest.retryQueue.push({
              rowIndex: r.rowIndex,
              recordHash: r.recordHash,
              reason: r.reason ?? 'unknown',
            })
            progress.errors.push({
              batchId: prepared.batchId,
              rowIndex: r.rowIndex,
              reason: r.reason ?? 'unknown',
            })
          }
          if (r.status === 'inserted' && r.recordHash) {
            manifest.idempotencyHashes.push(r.recordHash)
          }
        }
        let reconcile
        if (options.reconcileAfterEachBatch) {
          reconcile = await options.adapter.reconcile(prepared)
        }
        const rollbackPreview = await options.adapter.previewRollback(prepared.batchId)
        manifest.batches.push({
          batchId: prepared.batchId,
          recordsAttempted: slice.length,
          recordsInserted: batchResult.inserted,
          recordsSkipped: batchResult.skipped,
          recordsFailed: batchResult.failed,
          recordsConflict: batchResult.conflicts,
          adapterResult: batchResult,
          reconcile,
          rollbackPreview,
        })
        progress.batchesCompleted = i + 1
        progress.activeBatchId = null
        options.onProgress?.({ ...progress })
        if (pauseBetween > 0 && i < totalBatches - 1) {
          await delay(pauseBetween)
        }
      }
      setPhase('completed')
      finalize('completed')
      return manifest
    } catch (err) {
      setPhase('failed')
      finalize('failed')
      const e = err instanceof Error ? err : new Error(String(err))
      completionReject?.(e)
      throw e
    }
  }

  function finalize(phase: RunPhase) {
    progress.phase = phase
    progress.finishedAt = new Date().toISOString()
    manifest.finishedAt = progress.finishedAt
    options.onProgress?.({ ...progress })
    completionResolve?.(manifest)
  }

  const started = run()
  started.catch(() => {})

  return {
    runId,
    getProgress: () => ({ ...progress }),
    pause: () => {
      paused = true
    },
    resume: async () => {
      paused = false
      resumeSignal?.()
      resumeSignal = null
    },
    cancel: () => {
      cancelled = true
      paused = false
      resumeSignal?.()
      resumeSignal = null
    },
    retryFailed: async () => {
      const queue = manifest.retryQueue.splice(0, manifest.retryQueue.length)
      if (queue.length === 0) return manifest
      const hashesToRetry = new Set(queue.map((q) => q.recordHash))
      const records = options.records.filter((r) => {
        const anyRec = r as unknown as { leads_hash?: string; id?: string }
        const hash = anyRec.leads_hash ?? anyRec.id ?? ''
        return hashesToRetry.has(hash)
      })
      if (records.length === 0) return manifest
      const prepared = await options.adapter.prepareBatch({
        runId,
        batchIndex: manifest.batches.length,
        records,
      })
      const result = await options.adapter.insertBatch(prepared)
      manifest.batches.push({
        batchId: prepared.batchId,
        recordsAttempted: records.length,
        recordsInserted: result.inserted,
        recordsSkipped: result.skipped,
        recordsFailed: result.failed,
        recordsConflict: result.conflicts,
        adapterResult: result,
      })
      progress.recordsAttempted += records.length
      progress.recordsInserted += result.inserted
      progress.recordsSkipped += result.skipped
      progress.recordsFailed += result.failed
      progress.recordsConflict += result.conflicts
      for (const r of result.perRecord) {
        if (r.status === 'failed') {
          manifest.retryQueue.push({
            rowIndex: r.rowIndex,
            recordHash: r.recordHash,
            reason: r.reason ?? 'unknown',
          })
        }
      }
      options.onProgress?.({ ...progress })
      return manifest
    },
    rollbackPreview: async (): Promise<AdapterRollbackPreview[]> => {
      const previews: AdapterRollbackPreview[] = []
      for (const b of manifest.batches) {
        previews.push(await options.adapter.previewRollback(b.batchId))
      }
      return previews
    },
    manifest: () => manifest,
    completion,
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
