import type {
  AdapterBatchResult,
  AdapterReconcileReport,
  AdapterRollbackPreview,
  DestinationAdapter,
} from '@/lib/adapters/types'

export type RunPhase =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'paused'
  | 'cancelled'
  | 'completed'
  | 'failed'

export interface RunProgress {
  runId: string
  phase: RunPhase
  totalRecords: number
  totalBatches: number
  batchesCompleted: number
  recordsAttempted: number
  recordsInserted: number
  recordsSkipped: number
  recordsFailed: number
  recordsConflict: number
  startedAt: string | null
  updatedAt: string
  finishedAt: string | null
  mode: 'MOCK' | 'DRY_RUN' | 'LIVE'
  activeBatchId: string | null
  errors: Array<{ batchId: string; rowIndex: number; reason: string }>
}

export interface RunManifest<R> {
  runId: string
  destination: 'sql' | 'cosmos'
  mode: 'MOCK' | 'DRY_RUN' | 'LIVE'
  totalRecords: number
  batchSize: number
  startedAt: string
  finishedAt: string | null
  batches: Array<{
    batchId: string
    recordsAttempted: number
    recordsInserted: number
    recordsSkipped: number
    recordsFailed: number
    recordsConflict: number
    adapterResult: AdapterBatchResult<R>
    reconcile?: AdapterReconcileReport
    rollbackPreview?: AdapterRollbackPreview
  }>
  retryQueue: Array<{ rowIndex: number; recordHash: string; reason: string }>
  idempotencyHashes: string[]
}

export interface BatchRunnerOptions<R> {
  runId?: string
  destination: 'sql' | 'cosmos'
  adapter: DestinationAdapter<R>
  records: R[]
  batchSize?: number
  pauseBetweenBatchesMs?: number
  reconcileAfterEachBatch?: boolean
  onProgress?: (p: RunProgress) => void
}

export interface BatchRunHandle<R> {
  runId: string
  getProgress: () => RunProgress
  pause: () => void
  resume: () => Promise<void>
  cancel: () => void
  retryFailed: () => Promise<RunManifest<R>>
  rollbackPreview: () => Promise<AdapterRollbackPreview[]>
  manifest: () => RunManifest<R>
  completion: Promise<RunManifest<R>>
}
