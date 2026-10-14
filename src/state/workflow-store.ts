import { create } from 'zustand'
import type {
  Destination,
  FieldMapping,
  MigrationMode,
  MigrationResultCounts,
  MigrationResultSummary,
  ParsedFile,
  ValidationIssue,
  WizardStepId,
} from '@/types'
import { LEMON_FIELD_MAPPINGS } from '@/config/cosmos-mapping'
import { SQL_FIELD_MAPPINGS } from '@/config/sql-mapping'
import { runValidation, type ValidationEngineOutput } from '@/lib/validation'
import type { SqlRecord } from '@/lib/transform/sql-generator'
import type {
  CosmosLeadDocument,
  CosmosWonDocument,
} from '@/lib/transform/cosmos-generator'
import { createMockSqlAdapter } from '@/lib/adapters/sql-adapter'
import { createHttpSqlAdapter } from '@/lib/adapters/http-sql-adapter'
import {
  createMockCosmosAdapter,
  type CosmosWritable,
} from '@/lib/adapters/cosmos-adapter'
import type {
  AdapterConnectionProbe,
  DestinationAdapter,
} from '@/lib/adapters/types'
import { createBatchRunner, type RunManifest, type RunProgress } from '@/lib/batch'
import { newRunId } from '@/lib/transform/identifiers'

export type ExecutionMode = 'DRY_RUN' | 'SQL_LOCAL_TEST'

/**
 * Browser-side backend base URL.
 *
 * Defaults to an empty string so that in-app `fetch('/api/...')` calls hit
 * the Vite dev proxy on the same origin (no CORS, no hard-coded host). Set
 * VITE_MIGRATION_SERVER_URL at build time to point at a specific backend
 * (e.g., when the UI is served from a different host than the backend).
 */
export const BACKEND_BASE_URL =
  (import.meta.env.VITE_MIGRATION_SERVER_URL as string | undefined) ?? ''

export const COSMOS_DEV_STATUS =
  'Cosmos DEV — Pending Integration. Awaiting Azure DEV credentials + Lemon Vireya API contract. Local emulator POC is deferred.'

interface WorkflowState {
  destination: Destination | null
  currentStep: WizardStepId
  parsedFile: ParsedFile | null
  mappings: FieldMapping[]
  issues: ValidationIssue[]
  result: MigrationResultSummary | null
  /**
   * Shared prepared payload: Preview, JSON download, and SQL Local Test
   * batch all read from `validation.sqlResult.records` so timestamps
   * (`created_at`, `updated_at`) are stable within a single prepared run.
   */
  validation: ValidationEngineOutput | null
  batchProgress: RunProgress | null
  batchManifest: RunManifest<unknown> | null
  executionMode: ExecutionMode
  backendProbe: AdapterConnectionProbe | null
  backendProbeError: string | null
}

interface WorkflowActions {
  startWorkflow: (destination: Destination) => void
  setStep: (step: WizardStepId) => void
  setParsedFile: (file: ParsedFile | null) => void
  updateMapping: (destinationField: string, sourceField: string | null) => void
  runValidation: () => void
  decideIssue: (
    issueId: string,
    decision: 'approve' | 'exclude' | null,
  ) => void
  setExecutionMode: (mode: ExecutionMode) => void
  probeBackend: () => Promise<void>
  simulateMigration: () => Promise<void>
  reset: () => void
}

const defaultMappingsFor = (destination: Destination): FieldMapping[] =>
  destination === 'lemon'
    ? LEMON_FIELD_MAPPINGS.map((m) => ({ ...m }))
    : SQL_FIELD_MAPPINGS.map((m) => ({ ...m }))

const emptyState: WorkflowState = {
  destination: null,
  currentStep: 'upload',
  parsedFile: null,
  mappings: [],
  issues: [],
  result: null,
  validation: null,
  batchProgress: null,
  batchManifest: null,
  executionMode: 'DRY_RUN',
  backendProbe: null,
  backendProbeError: null,
}

export const useWorkflowStore = create<WorkflowState & WorkflowActions>(
  (set, get) => ({
    ...emptyState,

    startWorkflow: (destination) =>
      set({
        ...emptyState,
        destination,
        mappings: defaultMappingsFor(destination),
      }),

    setStep: (step) => set({ currentStep: step }),

    setParsedFile: (file) =>
      // Invalidate the prepared payload: a new source file means every
      // transformed record (including timestamps) must regenerate.
      set({
        parsedFile: file,
        validation: null,
        issues: [],
        result: null,
        batchProgress: null,
        batchManifest: null,
      }),

    updateMapping: (destinationField, sourceField) =>
      // Mapping change invalidates the prepared payload — Review and
      // Preview must re-derive from a fresh validation run.
      set((state) => ({
        mappings: state.mappings.map((m) =>
          m.destinationField === destinationField
            ? { ...m, sourceField }
            : m,
        ),
        validation: null,
        issues: [],
        result: null,
      })),

    runValidation: () => {
      const { destination, parsedFile } = get()
      if (!destination || !parsedFile) return
      // Validation produces the canonical, timestamped record set shared by
      // Preview / Download / Batch within this prepared run.
      const output = runValidation({ destination, parsed: parsedFile })
      set({
        issues: output.issues,
        validation: output,
        result: null,
        batchProgress: null,
        batchManifest: null,
      })
    },

    decideIssue: (issueId, decision) =>
      set((state) => ({
        issues: state.issues.map((issue) =>
          issue.id === issueId ? { ...issue, decision } : issue,
        ),
      })),

    setExecutionMode: (mode) => set({ executionMode: mode }),

    probeBackend: async () => {
      try {
        const resp = await fetch(`${BACKEND_BASE_URL}/api/sql/validate-connection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        const data = await resp.json()
        if (!resp.ok) {
          set({ backendProbe: null, backendProbeError: data?.error ?? `HTTP ${resp.status}` })
          return
        }
        set({ backendProbe: data as AdapterConnectionProbe, backendProbeError: null })
      } catch (err) {
        set({
          backendProbe: null,
          backendProbeError: err instanceof Error ? err.message : String(err),
        })
      }
    },

    simulateMigration: async () => {
      const { destination, parsedFile, issues, validation, executionMode } = get()
      if (!destination || !parsedFile || !validation) return

      const excludedRowSet = new Set(
        issues.filter((i) => i.decision === 'exclude').map((i) => i.rowIndex),
      )

      const runId = newRunId(destination === 'sql' ? 'SQLRUN' : 'COSRUN')
      const started = new Date()

      if (destination === 'sql') {
        // All three consumers (Preview, download, batch) share these exact
        // record objects. Timestamps were set by the validation run and are
        // not regenerated here.
        const sqlRecordWrappers = validation.sqlResult?.records ?? []
        const sourceTotal = parsedFile.rowCount
        const blockedByValidation = sqlRecordWrappers.filter((r) => r.blocked).length
        const excluded = excludedRowSet.size
        const eligible = sqlRecordWrappers
          .filter((r) => !r.blocked && !excludedRowSet.has(r.rowIndex))
          .map((r) => r.record)

        const useLive = executionMode === 'SQL_LOCAL_TEST'
        const adapter: DestinationAdapter<SqlRecord> = useLive
          ? createHttpSqlAdapter({ baseUrl: BACKEND_BASE_URL })
          : createMockSqlAdapter({ dryRun: true })
        const handle = createBatchRunner<SqlRecord>({
          destination: 'sql',
          adapter,
          records: eligible,
          batchSize: 500,
          runId,
          reconcileAfterEachBatch: useLive,
          onProgress: (p) => set({ batchProgress: { ...p } }),
        })
        const manifest = await handle.completion
        const readback = await verifyIfLive(adapter, manifest, useLive)
        set({
          batchManifest: manifest as RunManifest<unknown>,
          result: toResultSummary({
            destination,
            runId,
            started,
            finished: new Date(),
            source: sourceTotal,
            blocked: blockedByValidation,
            excluded,
            eligible: eligible.length,
            manifest,
            mode: adapter.mode,
            readback,
          }),
        })
      } else {
        // Cosmos: local execution is intentionally disabled. Everything is
        // forced through the MOCK adapter; no success count is reported.
        const leads = (validation.cosmosResult?.leads ?? [])
          .filter((r) => !r.blocked && !excludedRowSet.has(r.rowIndex))
          .map((r) => r.record as CosmosLeadDocument)
        const won = (validation.cosmosResult?.wonSnapshots ?? [])
          .filter((r) => !r.blocked && !excludedRowSet.has(r.rowIndex))
          .map((r) => r.record as CosmosWonDocument)
        const records: CosmosWritable[] = [...leads, ...won]
        const sourceTotal = parsedFile.rowCount
        const blockedByValidation =
          (validation.cosmosResult?.leads.filter((r) => r.blocked).length ?? 0) +
          (validation.cosmosResult?.wonSnapshots.filter((r) => r.blocked).length ?? 0)
        const adapter = createMockCosmosAdapter({ dryRun: true })
        const handle = createBatchRunner<CosmosWritable>({
          destination: 'cosmos',
          adapter,
          records,
          batchSize: 500,
          runId,
          reconcileAfterEachBatch: false,
          onProgress: (p) => set({ batchProgress: { ...p } }),
        })
        const manifest = await handle.completion
        set({
          batchManifest: manifest as RunManifest<unknown>,
          result: toResultSummary({
            destination,
            runId,
            started,
            finished: new Date(),
            source: sourceTotal,
            blocked: blockedByValidation,
            excluded: excludedRowSet.size,
            eligible: records.length,
            manifest,
            mode: adapter.mode,
            extraNotes: [
              COSMOS_DEV_STATUS,
              `MOCK Cosmos containers (dry): leads=${leads.length}, leads-won=${won.length}`,
            ],
          }),
        })
      }
    },

    reset: () => set(emptyState),
  }),
)

async function verifyIfLive<R>(
  adapter: DestinationAdapter<R>,
  manifest: RunManifest<R>,
  useLive: boolean,
): Promise<{ verified: number; missing: string[] } | null> {
  if (!useLive) return null
  const results: { verified: number; missing: string[] }[] = []
  for (const b of manifest.batches) {
    const prepared = {
      batchId: b.batchId,
      runId: manifest.runId,
      records: b.adapterResult.perRecord
        .filter((r) => r.status === 'inserted' && r.record !== undefined)
        .map((r) => r.record as R),
      mode: adapter.mode,
    }
    if (prepared.records.length === 0) continue
    const check = await adapter.verifyInsertedRecords(prepared)
    results.push({ verified: check.verified, missing: check.missingHashes })
  }
  return {
    verified: results.reduce((n, r) => n + r.verified, 0),
    missing: results.flatMap((r) => r.missing),
  }
}

interface ResultArgs {
  destination: Destination
  runId: string
  started: Date
  finished: Date
  source: number
  blocked: number
  excluded: number
  eligible: number
  manifest: RunManifest<unknown>
  mode: 'MOCK' | 'DRY_RUN' | 'LIVE'
  extraNotes?: string[]
  readback?: { verified: number; missing: string[] } | null
}

function modeFor(
  destination: Destination,
  adapterMode: 'MOCK' | 'DRY_RUN' | 'LIVE',
): { mode: MigrationMode; label: string } {
  if (adapterMode === 'LIVE') {
    return { mode: 'SQL_LOCAL_TEST', label: 'SQL Local Test' }
  }
  if (destination === 'lemon') {
    return { mode: 'DRY_RUN', label: 'Cosmos DEV — Pending Integration' }
  }
  return { mode: 'DRY_RUN', label: 'Dry Run — No Database Writes' }
}

function toResultSummary(args: ResultArgs): MigrationResultSummary {
  const { destination, runId, started, finished, manifest, mode, readback } = args
  const inserted = manifest.batches.reduce((n, b) => n + b.recordsInserted, 0)
  const skipped = manifest.batches.reduce((n, b) => n + b.recordsSkipped, 0)
  const failed = manifest.batches.reduce((n, b) => n + b.recordsFailed, 0)
  const conflicts = manifest.batches.reduce((n, b) => n + b.recordsConflict, 0)
  const attempted = manifest.batches.reduce((n, b) => n + b.recordsAttempted, 0)
  const verified = readback?.verified ?? null
  // Confirmed success metric: verified read-back in LIVE, nothing in DRY RUN.
  // We NEVER hard-code success — the batch's own counts drive this.
  const successfulReported =
    mode === 'LIVE'
      ? verified !== null
        ? verified
        : inserted
      : 0

  const counts: MigrationResultCounts = {
    source: args.source,
    excluded: args.excluded,
    blocked: args.blocked,
    eligible: args.eligible,
    attempted,
    inserted,
    skipped,
    failed,
    conflicts,
    verified,
  }

  const { mode: resultMode, label: modeLabel } = modeFor(destination, mode)

  const batches = manifest.batches.map((b) => ({
    batchId: b.batchId,
    attempted: b.recordsAttempted,
    inserted: b.recordsInserted,
    skipped: b.recordsSkipped,
    failed: b.recordsFailed,
    conflicts: b.recordsConflict,
    insertedIds: b.adapterResult.perRecord
      .filter((r) => r.status === 'inserted')
      .map((r) => r.recordHash),
    failures: b.adapterResult.perRecord
      .filter((r) => r.status === 'failed')
      .map((r) => ({
        recordHash: r.recordHash,
        rowIndex: r.rowIndex,
        reason: r.reason ?? 'unknown',
      })),
  }))

  const notes: string[] = []
  if (mode === 'LIVE') {
    notes.push(
      `${modeLabel}: wrote to the local SQL Server container. No production system was contacted.`,
    )
    if (verified !== null) {
      notes.push(
        `Read-back verified ${verified}/${inserted} inserted row(s)${
          readback?.missing.length ? ` — missing: ${readback.missing.slice(0, 3).join(', ')}` : ''
        }.`,
      )
    } else {
      notes.push('Read-back was skipped.')
    }
  } else {
    notes.push(
      `${modeLabel}: no database writes occurred. The success count is reported as 0 because nothing was executed.`,
    )
  }
  notes.push(
    `Chain: source=${counts.source} · excluded=${counts.excluded} · blocked=${counts.blocked} · eligible=${counts.eligible} · attempted=${counts.attempted} · inserted=${counts.inserted} · verified=${counts.verified ?? '—'}.`,
  )
  notes.push(
    `Batches: ${manifest.batches.length}; retry queue: ${manifest.retryQueue.length}; idempotency hashes: ${manifest.idempotencyHashes.length}; conflicts: ${conflicts}.`,
  )
  if (args.extraNotes) notes.push(...args.extraNotes)

  return {
    jobId: runId,
    destination,
    destinationLabel:
      destination === 'lemon'
        ? 'CXLite · Cosmos DB (DEV pending)'
        : 'SQL Server · analytic_leads_sales',
    mode: resultMode,
    modeLabel,
    totalRecords: args.source,
    successful: successfulReported,
    failed,
    skipped: skipped + args.excluded,
    pending: Math.max(0, args.eligible - successfulReported - skipped - failed - conflicts),
    counts,
    batches,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    simulated: mode !== 'LIVE',
    retryable: manifest.retryQueue.length > 0 || failed > 0,
    notes,
  }
}
