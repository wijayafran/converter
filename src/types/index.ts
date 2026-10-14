export type Destination = 'lemon' | 'sql'

export type MappingType =
  | 'Direct'
  | 'Transform'
  | 'Generated'
  | 'Default'
  | 'Nested'
  | 'Ignored'

export type MappingStatus =
  | 'matched'
  | 'required-missing'
  | 'optional-missing'
  | 'extra-source'

export type MappingRequirement = 'required' | 'optional'

export interface FieldMapping {
  sourceField: string | null
  destinationField: string
  destinationPath?: string
  requirement: MappingRequirement
  type: MappingType
  description: string
  example?: string
  verified?: boolean
}

export interface MappingSuggestion {
  destinationField: string
  possibleSourceFields: string[]
}

export type IssueSeverity = 'VALID' | 'WARNING' | 'BLOCKED'

export type IssueCategory =
  | 'missing-required'
  | 'invalid-type'
  | 'duplicate-id'
  | 'duplicate-phone'
  | 'duplicate-phone-assignee'
  | 'id-collision'
  | 'invalid-date'
  | 'invalid-phone'
  | 'precision-loss'
  | 'mapping-incompatible'
  | 'destination-constraint'
  | 'unknown-status'
  | 'unresolved-status'
  | 'pending-status-mapping'
  | 'unknown-source'
  | 'pending-source-mapping'
  | 'missing-won-field'
  | 'partial-won'

export interface ValidationIssue {
  id: string
  rowIndex: number
  severity: IssueSeverity
  category: IssueCategory
  sourceField: string
  destinationField: string
  originalValue: string | number | null
  proposedValue: string | number | null
  description: string
  recommendedAction: string
  decision?: 'approve' | 'exclude' | null
}

export interface ParsedFile {
  fileName: string
  fileSize: number
  sheetName: string
  rowCount: number
  columnCount: number
  headers: string[]
  rows: Array<Record<string, unknown>>
}

export type MigrationMode = 'DRY_RUN' | 'SQL_LOCAL_TEST' | 'LIVE'

export interface MigrationResultCounts {
  /** Rows in the uploaded Excel. */
  source: number
  /** Rows excluded by user decision in Review. */
  excluded: number
  /** Rows blocked by validation (unresolved status, duplicates, etc). */
  blocked: number
  /** Rows eligible for the batch (source − excluded − blocked). */
  eligible: number
  /** Rows actually sent to the adapter. */
  attempted: number
  /** Rows the adapter reports as inserted. */
  inserted: number
  /** Rows the adapter refused (DRY_RUN=true). */
  skipped: number
  /** Rows that failed (SQL error, network, etc). */
  failed: number
  /** Rows the adapter treated as idempotent conflicts (PK already present). */
  conflicts: number
  /**
   * Rows the adapter confirmed via a read-back SELECT. The confirmed
   * success metric for LIVE. Null when read-back wasn't attempted (DRY RUN).
   */
  verified: number | null
}

export interface MigrationResultSummary {
  jobId: string
  destination: Destination
  destinationLabel: string
  mode: MigrationMode
  modeLabel: string
  /** Alias of counts.source, kept for backwards compat with older UI. */
  totalRecords: number
  /** Alias of counts.verified ?? counts.inserted (LIVE) or 0 (DRY RUN). */
  successful: number
  failed: number
  skipped: number
  pending: number
  counts: MigrationResultCounts
  batches: Array<{
    batchId: string
    attempted: number
    inserted: number
    skipped: number
    failed: number
    conflicts: number
    insertedIds: string[]
    failures: Array<{ recordHash: string; rowIndex: number; reason: string }>
  }>
  startedAt: string
  finishedAt: string
  simulated: boolean
  retryable: boolean
  notes: string[]
}

export type WizardStepId =
  | 'upload'
  | 'mapping'
  | 'validation'
  | 'review'
  | 'preview'
  | 'result'

export interface WizardStep {
  id: WizardStepId
  label: string
  description: string
}
