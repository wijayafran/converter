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
}
