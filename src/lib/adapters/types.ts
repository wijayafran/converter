/**
 * Destination adapter contract.
 *
 * All adapters MUST honour the DRY_RUN flag embedded in every record:
 *   - `leads_migration_dry_run === true` (SQL)
 *   - `migrationDryRun === true`         (Cosmos)
 * If a production adapter sees DRY_RUN=true in `insertBatch`, it MUST refuse
 * the batch rather than silently writing it.
 *
 * The interface is intentionally transport-agnostic — a mock-only
 * implementation (used for Phase 1 UI and tests) and real
 * SQL/Cosmos/Lemon-Vireya implementations (Phase 2) share this shape.
 */

export type AdapterMode = 'MOCK' | 'DRY_RUN' | 'LIVE'

export interface AdapterConnectionProbe {
  ok: boolean
  mode: AdapterMode
  destinationLabel: string
  version?: string
  latencyMs: number
  notes: string[]
}

export interface AdapterRecordResult<R = Record<string, unknown>> {
  recordHash: string
  rowIndex: number
  status: 'inserted' | 'skipped' | 'conflict' | 'failed'
  reason?: string
  simulated: boolean
  record?: R
}

export interface AdapterBatchResult<R = Record<string, unknown>> {
  batchId: string
  mode: AdapterMode
  inserted: number
  skipped: number
  conflicts: number
  failed: number
  startedAt: string
  finishedAt: string
  perRecord: Array<AdapterRecordResult<R>>
  warnings: string[]
}

export interface AdapterReconcileReport {
  batchId: string
  expected: number
  observed: number
  missing: string[]
  extra: string[]
  mismatchedHashes: string[]
  reconciledAt: string
}

export interface AdapterRollbackPreview {
  batchId: string
  marker: string
  wouldDelete: number
  sampleIds: string[]
  warnings: string[]
}

export interface PreparedBatch<R = Record<string, unknown>> {
  batchId: string
  runId: string
  records: R[]
  mode: AdapterMode
}

export interface DestinationAdapter<R = Record<string, unknown>> {
  readonly name: string
  readonly mode: AdapterMode

  validateConnection(): Promise<AdapterConnectionProbe>
  prepareBatch(input: {
    runId: string
    batchIndex: number
    records: R[]
  }): Promise<PreparedBatch<R>>
  insertBatch(batch: PreparedBatch<R>): Promise<AdapterBatchResult<R>>
  verifyInsertedRecords(batch: PreparedBatch<R>): Promise<{
    verified: number
    missingHashes: string[]
  }>
  previewRollback(batchId: string): Promise<AdapterRollbackPreview>
  reconcile(batch: PreparedBatch<R>): Promise<AdapterReconcileReport>
}
