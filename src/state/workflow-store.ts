import { create } from 'zustand'
import type {
  Destination,
  FieldMapping,
  MigrationResultSummary,
  ParsedFile,
  ValidationIssue,
  WizardStepId,
} from '@/types'
import { LEMON_FIELD_MAPPINGS } from '@/config/lemon-mapping'
import { SQL_FIELD_MAPPINGS } from '@/config/sql-mapping'
import { buildMockIssues } from '@/mocks/validation'

interface WorkflowState {
  destination: Destination | null
  currentStep: WizardStepId
  parsedFile: ParsedFile | null
  mappings: FieldMapping[]
  issues: ValidationIssue[]
  result: MigrationResultSummary | null
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
  simulateMigration: () => void
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
      const dest = get().destination
      if (!dest) return
      set({ issues: buildMockIssues(dest) })
    },

    decideIssue: (issueId, decision) =>
      set((state) => ({
        issues: state.issues.map((issue) =>
          issue.id === issueId ? { ...issue, decision } : issue,
        ),
      })),

    simulateMigration: () => {
      const { destination, parsedFile, issues } = get()
      if (!destination || !parsedFile) return
      const excluded = issues.filter((i) => i.decision === 'exclude').length
      const blocked = issues.filter(
        (i) => i.severity === 'BLOCKED' && i.decision !== 'exclude',
      ).length
      const total = parsedFile.rowCount
      const successful = Math.max(0, total - excluded - blocked)
      const now = new Date()
      const started = new Date(now.getTime() - 4 * 1000)
      set({
        result: {
          jobId: `SIM-${now.getTime().toString(36).toUpperCase()}`,
          destination,
          destinationLabel:
            destination === 'lemon' ? 'Lemon / CXLite' : 'SQL Server',
          totalRecords: total,
          successful,
          failed: 0,
          skipped: excluded,
          pending: blocked,
          startedAt: started.toISOString(),
          finishedAt: now.toISOString(),
          simulated: true,
          retryable: false,
          notes: [
            'Hasil ini merupakan simulasi. Tidak ada data yang dikirim ke sistem tujuan.',
            destination === 'lemon'
              ? 'Submit ke Lemon API dinonaktifkan hingga Phase 2.'
              : 'Insert ke SQL Server dinonaktifkan hingga Phase 2.',
          ],
        },
      })
    },

    reset: () => set(emptyState),
  }),
)
