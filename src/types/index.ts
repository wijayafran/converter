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
  | 'invalid-date'
  | 'invalid-phone'
  | 'precision-loss'
  | 'mapping-incompatible'
  | 'destination-constraint'

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

export interface MigrationResultSummary {
  jobId: string
  destination: Destination
  destinationLabel: string
  totalRecords: number
  successful: number
  failed: number
  skipped: number
  pending: number
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
