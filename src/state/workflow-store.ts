import { create } from 'zustand'
import type {
  Destination,
  FieldMapping,
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
  'Cosmos DEV integration pending — awaiting Azure DEV credentials + Lemon Vireya API contract. Local emulator POC is deferred.'

interface WorkflowState {
  destination: Destination | null
  currentStep: WizardStepId
  parsedFile: ParsedFile | null
  mappings: FieldMapping[]
  issues: ValidationIssue[]
  result: MigrationResultSummary | null
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

    setParsedFile: (file) => set({ parsedFile: file }),

    updateMapping: (destinationField, sourceField) =>
      set((state) => ({
        mappings: state.mappings.map((m) =>
          m.destinationField === destinationField
            ? { ...m, sourceField }
            : m,
        ),
      })),

    runValidation: () => {
      const { destination, parsedFile } = get()
      if (!destination || !parsedFile) return
      const output = runValidation({ destination, parsed: parsedFile })
      set({
        issues: output.issues,
        validation: output,
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

      const excludedRows = new Set(
        issues.filter((i) => i.decision === 'exclude').map((i) => i.rowIndex),
      )

      const runId = newRunId(destination === 'sql' ? 'SQLRUN' : 'COSRUN')
      const started = new Date()

      if (destination === 'sql') {
        const records: SqlRecord[] =
          validation.sqlResult?.records
            .filter((r) => !r.blocked && !excludedRows.has(r.rowIndex))
            .map((r) => r.record) ?? []

        const useLive = executionMode === 'SQL_LOCAL_TEST'
        const adapter: DestinationAdapter<SqlRecord> = useLive
          ? createHttpSqlAdapter({ baseUrl: BACKEND_BASE_URL })
          : createMockSqlAdapter({ dryRun: true })
        const handle = createBatchRunner<SqlRecord>({
          destination: 'sql',
          adapter,
          records,
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
            total: records.length,
            manifest,
            excluded: excludedRows.size,
            mode: adapter.mode,
            readback,
          }),
        })
      } else {
        // Cosmos: local execution is intentionally disabled in Phase 2B.
        // Everything is forced through the MOCK adapter and the result is
        // labelled "Cosmos DEV integration pending". No real insert count is
        // reported.
        const leads = (validation.cosmosResult?.leads ?? [])
          .filter((r) => !r.blocked && !excludedRows.has(r.rowIndex))
          .map((r) => r.record as CosmosLeadDocument)
        const won = (validation.cosmosResult?.wonSnapshots ?? [])
          .filter((r) => !r.blocked && !excludedRows.has(r.rowIndex))
          .map((r) => r.record as CosmosWonDocument)
        const records: CosmosWritable[] = [...leads, ...won]
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
            total: records.length,
            manifest,
            excluded: excludedRows.size,
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
  total: number
  manifest: RunManifest<unknown>
  excluded: number
  mode: 'MOCK' | 'DRY_RUN' | 'LIVE'
  extraNotes?: string[]
  readback?: { verified: number; missing: string[] } | null
}

function toResultSummary(args: ResultArgs): MigrationResultSummary {
  const { destination, runId, started, finished, manifest, excluded, mode, readback } = args
  const inserted = manifest.batches.reduce((n, b) => n + b.recordsInserted, 0)
  const skipped = manifest.batches.reduce((n, b) => n + b.recordsSkipped, 0)
  const failed = manifest.batches.reduce((n, b) => n + b.recordsFailed, 0)
  const conflicts = manifest.batches.reduce((n, b) => n + b.recordsConflict, 0)
  const verifiedCount = readback?.verified ?? null
  const successfulReported =
    mode === 'LIVE' && readback
      ? verifiedCount ?? 0
      : mode === 'LIVE'
        ? inserted
        : 0 // MOCK/DRY_RUN never report inserts as real success
  const notes: string[] = [
    `Mode: ${mode}${mode === 'LIVE' ? ' (local SQL Server POC)' : ' (simulated, no production data touched)'}.`,
    `Batches executed: ${manifest.batches.length}; retry queue: ${manifest.retryQueue.length}.`,
    `Idempotency hashes recorded: ${manifest.idempotencyHashes.length}.`,
    `Rows excluded by user decision: ${excluded}.`,
    `Conflicts (idempotent skip): ${conflicts}.`,
  ]
  if (mode === 'LIVE') {
    if (readback) {
      notes.push(
        `Read-back verified ${verifiedCount}/${inserted} inserted rows${
          readback.missing.length > 0 ? ` — missing: ${readback.missing.slice(0, 3).join(', ')}` : ''
        }.`,
      )
    } else {
      notes.push('Read-back skipped.')
    }
  } else {
    notes.push(
      'MOCK/DRY_RUN: 0 rows reported as successful. Switch to SQL Local Test to run against the local SQL Server container.',
    )
  }
  if (args.extraNotes) notes.push(...args.extraNotes)

  return {
    jobId: runId,
    destination,
    destinationLabel:
      destination === 'lemon'
        ? 'CXLite · Cosmos DB (DEV pending)'
        : 'SQL Server · analytic_leads_sales',
    totalRecords: args.total,
    successful: successfulReported,
    failed,
    skipped: skipped + excluded,
    pending: Math.max(0, args.total - successfulReported - skipped - failed - conflicts),
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    simulated: mode !== 'LIVE',
    retryable: manifest.retryQueue.length > 0 || failed > 0,
    notes,
  }
}
