import type { IssueSeverity } from '@/types'

export interface TransformIssue {
  severity: IssueSeverity
  category: string
  field: string
  message: string
  rowIndex: number
  originalValue?: unknown
  proposedValue?: unknown
}

export interface TransformedRecord<T = Record<string, unknown>> {
  rowIndex: number
  sourceId: string | null
  record: T
  issues: TransformIssue[]
  warnings: TransformIssue[]
  blockingIssues: TransformIssue[]
  blocked: boolean
  hash: string
  skipped: boolean
}

export interface TransformResult<T = Record<string, unknown>> {
  runId: string
  destination: 'sql' | 'cosmos'
  destinationLabel: string
  transformedAt: string
  records: Array<TransformedRecord<T>>
  issues: TransformIssue[]
  summary: {
    total: number
    valid: number
    warning: number
    blocked: number
    duplicates: number
  }
}

export interface TransformContext {
  runId: string
  dryRun: boolean
  waMobilePrefix: string
  now: Date
  /**
   * Metadata value written to the SQL row-provenance column (`created_by`
   * and `updated_by`). Independent of `leads_created_by`, which is a
   * lead-level field. Default 'system-batch'; the Migration Excel
   * proposes 'DataMigration01' but the final value is awaiting
   * confirmation from Ecovia.
   */
  rowProvenanceUser?: string
}
