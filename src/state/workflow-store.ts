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
import type { CosmosLeadDocument, CosmosWonDocument } from '@/lib/transform/cosmos-generator'
import { createMockSqlAdapter } from '@/lib/adapters/sql-adapter'
import { createMockCosmosAdapter, type CosmosWritable } from '@/lib/adapters/cosmos-adapter'
import { createBatchRunner, type RunManifest, type RunProgress } from '@/lib/batch'
import { newRunId } from '@/lib/transform/identifiers'

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

    simulateMigration: async () => {
      const { destination, parsedFile, issues, validation } = get()
      if (!destination || !parsedFile || !validation) return

      const excludedRows = new Set(
        issues
          .filter((i) => i.decision === 'exclude')
          .map((i) => i.rowIndex),
      )

      const runId = newRunId(destination === 'sql' ? 'SQLRUN' : 'COSRUN')
      const started = new Date()

      if (destination === 'sql') {
        const records: SqlRecord[] =
          validation.sqlResult?.records
            .filter((r) => !r.blocked && !excludedRows.has(r.rowIndex))
            .map((r) => r.record) ?? []
        const adapter = createMockSqlAdapter()
        const handle = createBatchRunner<SqlRecord>({
          destination: 'sql',
          adapter,
          records,
          batchSize: 500,
          runId,
          reconcileAfterEachBatch: true,
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
          }),
        })
      } else {
        const leads = (validation.cosmosResult?.leads ?? [])
          .filter((r) => !r.blocked && !excludedRows.has(r.rowIndex))
          .map((r) => r.record as CosmosLeadDocument)
        const won = (validation.cosmosResult?.wonSnapshots ?? [])
          .filter((r) => !r.blocked && !excludedRows.has(r.rowIndex))
          .map((r) => r.record as CosmosWonDocument)
        const records: CosmosWritable[] = [...leads, ...won]
        const adapter = createMockCosmosAdapter()
        const handle = createBatchRunner<CosmosWritable>({
          destination: 'cosmos',
          adapter,
          records,
          batchSize: 500,
          runId,
          reconcileAfterEachBatch: true,
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
            total: leads.length,
            manifest,
            excluded: excludedRows.size,
            mode: adapter.mode,
            extraNotes: [
              `Cosmos containers written (mock): leads=${leads.length}, leads-won=${won.length}`,
            ],
          }),
        })
      }
    },

    reset: () => set(emptyState),
  }),
)

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
}

function toResultSummary(args: ResultArgs): MigrationResultSummary {
  const { destination, runId, started, finished, manifest, excluded, mode } = args
  const inserted = manifest.batches.reduce((n, b) => n + b.recordsInserted, 0)
  const skipped = manifest.batches.reduce((n, b) => n + b.recordsSkipped, 0)
  const failed = manifest.batches.reduce((n, b) => n + b.recordsFailed, 0)
  const conflicts = manifest.batches.reduce((n, b) => n + b.recordsConflict, 0)
  const notes: string[] = [
    `Mode: ${mode} — ${mode === 'LIVE' ? 'production write' : 'simulated, no production data touched'}.`,
    `Batches executed: ${manifest.batches.length}; retry queue: ${manifest.retryQueue.length}.`,
    `Idempotency hashes recorded: ${manifest.idempotencyHashes.length}.`,
    `Rows excluded by user decision: ${excluded}.`,
    `Conflicts (idempotent skip): ${conflicts}.`,
    ...(args.extraNotes ?? []),
  ]
  return {
    jobId: runId,
    destination,
    destinationLabel:
      destination === 'lemon' ? 'LEMONS / Cosmos DB' : 'SQL Server · analytic_leads_sales',
    totalRecords: args.total,
    successful: inserted,
    failed,
    skipped: skipped + excluded,
    pending: Math.max(0, args.total - inserted - skipped - failed - conflicts),
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    simulated: mode !== 'LIVE',
    retryable: manifest.retryQueue.length > 0 || failed > 0,
    notes,
  }
}
