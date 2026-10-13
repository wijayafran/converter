/**
 * Real validation engine.
 *
 * The transformers (SQL + Cosmos) already apply every deterministic rule as
 * part of producing a target record and attach the issues to each
 * `TransformedRecord`. This file is the thin glue that:
 *
 *   1. Runs the correct transformer for the chosen destination.
 *   2. Flattens the per-record issues into the `ValidationIssue[]` shape the
 *      existing wizard UI consumes.
 *   3. Preserves the transformed records so that Review / Preview / Batch
 *      steps don't have to re-run the transformation and can share the
 *      exact artefacts that drive validation.
 *
 * Structural errors (anything with a non-overridable `category`) are flagged
 * BLOCKED and the engine refuses to let the user "approve" past them — this
 * is enforced in `canOverride()`.
 */

import type {
  Destination,
  IssueCategory,
  IssueSeverity,
  ParsedFile,
  ValidationIssue,
} from '@/types'
import {
  transformToCosmos,
  type CosmosTransformResult,
} from '@/lib/transform/cosmos-generator'
import {
  transformToSqlRecords,
  type SqlRecord,
} from '@/lib/transform/sql-generator'
import type {
  TransformIssue,
  TransformResult,
  TransformedRecord,
} from '@/lib/transform/types'
import type { CosmosConfig } from '@/config/cosmos-mapping'

export type ValidationCategoryOverrideable = Exclude<
  IssueCategory,
  'missing-required' | 'duplicate-id' | 'invalid-date'
> | string

const STRUCTURAL_CATEGORIES = new Set([
  'missing-required',
  'duplicate-id',
  'invalid-date',
  'missing-won-field',
  'id-collision',
  // The analytics-group classifier is required for valid downstream
  // reporting. Unresolved and pending status mappings are NEVER
  // overridable by a user acknowledgement — the migrator must either
  // resolve the mapping in status-taxonomy.ts or exclude the row.
  'unresolved-status',
  'pending-status-mapping',
  // Qonex-known source values whose CXLite canonical is a proposal
  // awaiting Ecovia approval. Bulk-approving these would turn an
  // unresolved mapping into silent policy; keep them structural.
  'pending-source-mapping',
])

export interface ValidationEngineInput {
  destination: Destination
  parsed: ParsedFile
  runId?: string
  dryRun?: boolean
  now?: Date
  cosmosConfig?: CosmosConfig
}

export interface ValidationEngineOutput {
  destination: Destination
  issues: ValidationIssue[]
  summary: {
    total: number
    valid: number
    warning: number
    blocked: number
    duplicates: number
    wonCount?: number
    droppedCount?: number
  }
  sqlResult?: TransformResult<SqlRecord>
  cosmosResult?: CosmosTransformResult
}

export function runValidation(input: ValidationEngineInput): ValidationEngineOutput {
  if (input.destination === 'sql') {
    const result = transformToSqlRecords(input.parsed, {
      runId: input.runId,
      dryRun: input.dryRun ?? true,
      now: input.now,
    })
    return {
      destination: 'sql',
      issues: flattenIssues(result.records, 'sql'),
      summary: result.summary,
      sqlResult: result,
    }
  }
  const result = transformToCosmos(input.parsed, {
    runId: input.runId,
    dryRun: input.dryRun ?? true,
    now: input.now,
    config: input.cosmosConfig,
  })
  return {
    destination: 'lemon',
    issues: [
      ...flattenIssues(result.leads, 'cosmos'),
      ...flattenIssues(result.wonSnapshots, 'cosmos', 'won-'),
    ],
    summary: {
      ...result.summary,
      wonCount: result.summary.wonCount,
      droppedCount: result.summary.droppedCount,
    },
    cosmosResult: result,
  }
}

function flattenIssues<T>(
  records: Array<TransformedRecord<T>>,
  dest: 'sql' | 'cosmos',
  idPrefix = '',
): ValidationIssue[] {
  const out: ValidationIssue[] = []
  for (const r of records) {
    if (r.issues.length === 0) {
      out.push({
        id: `${idPrefix}${dest}-${r.rowIndex}-ok`,
        rowIndex: r.rowIndex,
        severity: 'VALID',
        category: 'destination-constraint',
        sourceField: '-',
        destinationField: '-',
        originalValue: null,
        proposedValue: null,
        description: 'All rules passed.',
        recommendedAction: 'No action required.',
      })
      continue
    }
    r.issues.forEach((issue, i) => {
      out.push(toValidationIssue(issue, r.rowIndex, `${idPrefix}${dest}-${r.rowIndex}-${i}`))
    })
  }
  return out
}

function toValidationIssue(
  issue: TransformIssue,
  rowIndex: number,
  id: string,
): ValidationIssue {
  const severity: IssueSeverity = issue.severity
  const category = mapCategory(issue.category)
  return {
    id,
    rowIndex,
    severity,
    category,
    sourceField: issue.field,
    destinationField: issue.field,
    originalValue: formatValue(issue.originalValue),
    proposedValue: formatValue(issue.proposedValue),
    description: issue.message,
    recommendedAction: recommendedAction(issue.category, severity),
  }
}

function mapCategory(raw: string): IssueCategory {
  const known: IssueCategory[] = [
    'missing-required',
    'invalid-type',
    'duplicate-id',
    'duplicate-phone',
    'duplicate-phone-assignee',
    'id-collision',
    'invalid-date',
    'invalid-phone',
    'precision-loss',
    'mapping-incompatible',
    'destination-constraint',
    'unknown-status',
    'unresolved-status',
    'pending-status-mapping',
    'unknown-source',
    'pending-source-mapping',
    'missing-won-field',
    'partial-won',
  ]
  if ((known as string[]).includes(raw)) return raw as IssueCategory
  if (raw.startsWith('duplicate') || raw.includes('collision')) return 'duplicate-id'
  if (raw.includes('phone')) return 'invalid-phone'
  if (raw.includes('date')) return 'invalid-date'
  return 'destination-constraint'
}

function recommendedAction(
  category: string,
  severity: IssueSeverity,
): string {
  if (severity === 'BLOCKED') {
    if (category === 'missing-required') {
      return 'Perbaiki pada sumber Excel atau kecualikan baris.'
    }
    if (category.includes('collision') || category.includes('duplicate')) {
      return 'Resolve duplicate ID in source before enabling production migration.'
    }
    if (category === 'invalid-date') {
      return 'Perbaiki format tanggal sumber (ISO 8601 atau DD/MM/YYYY).'
    }
    if (category === 'missing-won-field') {
      return 'Lengkapi field Won di sumber — tidak akan di-fabrikasi oleh engine.'
    }
    if (category === 'unresolved-status') {
      return 'Tambahkan canonical mapping di SQL_STATUS_RESOLUTIONS pada status-taxonomy.ts, atau kecualikan baris. Jangan setujui — grup FSM tidak boleh UNKNOWN.'
    }
    if (category === 'pending-status-mapping') {
      return 'FSM group pending konfirmasi Ecovia. Jangan setujui massal — tunggu konfirmasi atau kecualikan baris.'
    }
    return 'Perbaiki pada sumber sebelum dapat dilanjutkan.'
  }
  if (severity === 'WARNING') {
    if (category === 'pending-source-mapping') {
      return 'Nilai Qonex-dikenal; canonical CXLite usulan menunggu persetujuan Ecovia. Jangan setujui massal.'
    }
    if (category === 'unknown-source') {
      return 'Nilai source tidak dikenal di Qonex maupun CXLite — periksa sumber Excel.'
    }
    return 'Setujui jika nilai hasil normalisasi dapat diterima.'
  }
  return 'Tidak ada tindakan diperlukan.'
}

function formatValue(v: unknown): string | number | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'number' || typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

/**
 * Guards the "approve warning" button: structural errors can NEVER be
 * overridden with an acknowledgement — the only recourse is to exclude the
 * row or fix the source.
 */
export function canOverride(issue: ValidationIssue): boolean {
  if (issue.severity !== 'WARNING') return false
  return !STRUCTURAL_CATEGORIES.has(issue.category)
}

export function filterStructural(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter(
    (i) => i.severity === 'BLOCKED' && STRUCTURAL_CATEGORIES.has(i.category),
  )
}
