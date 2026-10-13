/**
 * Qonex → dev_analytic_cxlite.analytic_leads_sales transformer.
 *
 * Authoritative schema: see src/config/sql-mapping.ts (sourced from
 * analytics-sqlserver-lemons.md). The POC writes ONE snapshot row per lead
 * (`event_name = 'LEAD_CREATED'`) and leaves the `eventlog` table empty.
 *
 * All identifiers (`id`, `leads_id`) are UUIDv4 strings stored as varchar.
 * `leads_id` is stable per Qonex ID so a re-run reconciles cleanly.
 */

import type { ParsedFile } from '@/types'
import {
  digitsPhone,
  isBlank,
  normalizeEmail,
  normalizePhone,
  parseDate,
  safeNumericString,
  toInteger,
  trimString,
  waMobileId,
} from './primitives'
import { newRunId, stableUuid } from './identifiers'
import {
  SQL_ANALYTIC_LEADS_SALES_COLUMNS,
  SQL_TARGET_TABLE,
} from '@/config/sql-mapping'
import {
  cxliteSource,
  sqlGroupStatus,
  sqlStatusUpper,
} from '@/config/status-taxonomy'
import type {
  TransformContext,
  TransformIssue,
  TransformResult,
  TransformedRecord,
} from './types'

/** Row-provenance metadata (SQL `created_by` / `updated_by`) default. */
const DEFAULT_ROW_PROVENANCE_USER = 'system-batch'
/** URGENCY default — unchanged (no Qonex analogue, awaiting CXLite policy). */
const DEFAULT_URGENCY = 'Medium'
const PARENT_CHANNEL = 'ONLINE'
/**
 * Constant for `leads_created_by` only. The Migration Excel confirms the
 * migration itself as the lead-level creator since Qonex has no
 * `data.createdBy` analogue.
 */
const DATA_MIGRATION_USER = 'DataMigration01'
/** Hard varchar(2000) ceiling for leads_note. */
const LEADS_NOTE_MAX = 2000

export interface SqlRecord {
  [column: string]: string | number | boolean | null
}

export interface SqlTransformOptions {
  runId?: string
  waMobilePrefix?: string
  dryRun?: boolean
  now?: Date
  /**
   * Value written to the SQL row-provenance columns `created_by` and
   * `updated_by`. Defaults to 'system-batch' (the SQL default per the
   * authoritative DDL). The Migration Excel currently proposes
   * 'DataMigration01'; the final value is awaiting Ecovia confirmation.
   */
  rowProvenanceUser?: string
}

export function transformToSqlRecords(
  parsed: ParsedFile,
  options: SqlTransformOptions = {},
): TransformResult<SqlRecord> {
  const context: TransformContext = {
    runId: options.runId ?? newRunId('SQL'),
    dryRun: options.dryRun ?? true,
    waMobilePrefix: options.waMobilePrefix ?? 'wa_',
    now: options.now ?? new Date(),
    rowProvenanceUser: options.rowProvenanceUser ?? DEFAULT_ROW_PROVENANCE_USER,
  }

  const records: Array<TransformedRecord<SqlRecord>> = []
  const seenPkIds = new Map<string, number[]>()
  const seenLeadsIds = new Map<string, number[]>()
  const seenParentIds = new Map<string, number[]>()
  const allIssues: TransformIssue[] = []

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]
    const rowIndex = i + 1
    const transformed = transformOneSqlRow(row, rowIndex, context)
    records.push(transformed)
    allIssues.push(...transformed.issues)

    const pkId = transformed.record.id as string | null
    if (pkId) pushMap(seenPkIds, pkId, rowIndex)
    const leadsId = transformed.record.leads_id as string | null
    if (leadsId) pushMap(seenLeadsIds, leadsId, rowIndex)
    const parentId = transformed.record.leads_parent_id as string | null
    if (parentId) pushMap(seenParentIds, parentId, rowIndex)
  }

  // The analytic_leads_sales primary key is `id`. Under the WA_MOBILE
  // convention, duplicate phones in the source produce duplicate ids,
  // which would hit SQL error 2627 on insert. Block pre-emptively so the
  // migration manifest surfaces the collision before the batch is sent.
  for (const [id, rows] of seenPkIds.entries()) {
    if (rows.length > 1) {
      for (const r of rows) {
        attachBlocking(records, r, {
          severity: 'BLOCKED',
          category: 'duplicate-id',
          field: 'id',
          message: `Duplicate PK id "${id}" (WA_MOBILE identifier collides on rows ${rows.join(', ')} — Qonex source must dedupe by phone before migration)`,
          rowIndex: r,
          originalValue: id,
        })
      }
    }
  }
  for (const [id, rows] of seenLeadsIds.entries()) {
    if (rows.length > 1) {
      for (const r of rows) {
        attachBlocking(records, r, {
          severity: 'BLOCKED',
          category: 'duplicate-id',
          field: 'leads_id',
          message: `Duplicate leads_id "${id}" generated for rows ${rows.join(', ')} (upstream Qonex IDs collide)`,
          rowIndex: r,
          originalValue: id,
        })
      }
    }
  }
  for (const [parent, rows] of seenParentIds.entries()) {
    if (rows.length > 1) {
      for (const r of rows) {
        attachWarning(records, r, {
          severity: 'WARNING',
          category: 'duplicate-phone',
          field: 'leads_parent_id',
          message: `Phone-derived parent id ${parent} appears on rows ${rows.join(', ')} — resolved as BLOCKED on id above`,
          rowIndex: r,
          originalValue: parent,
        })
      }
    }
  }

  return {
    runId: context.runId,
    destination: 'sql',
    destinationLabel: 'SQL Server · analytic_leads_sales',
    transformedAt: context.now.toISOString(),
    records,
    issues: allIssues,
    summary: summarize(records),
  }
}

function transformOneSqlRow(
  row: Record<string, unknown>,
  rowIndex: number,
  ctx: TransformContext,
): TransformedRecord<SqlRecord> {
  const issues: TransformIssue[] = []
  const warnings: TransformIssue[] = []
  const blockingIssues: TransformIssue[] = []

  const legacyId = trimString(row['ID'])
  const name = trimString(row['nama_prospek'])
  const phoneResult = normalizePhone(row['nomor_telepon'])
  const email = normalizeEmail(row['email'])
  const salesRep = trimString(row['sales_rep'])
  const createDate = parseDate(row['create'])
  const updatedDate = parseDate(row['last_update'])
  const sourceInfo = cxliteSource(row['source_data'])
  const statusUpper = sqlStatusUpper(row['status'])
  const groupStatus = sqlGroupStatus(row['status'])
  const budget = safeNumericString(row['type_price'])
  const noteRaw = trimString(row['keterangan'])
  const noteOverflow = noteRaw !== null && noteRaw.length > LEADS_NOTE_MAX
  const cluster = trimString(row['cluster'])
  const phoneDigits = digitsPhone(phoneResult)
  const parentWa = waMobileId(phoneResult, ctx.waMobilePrefix)

  if (!legacyId) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'legacy_id',
      message: 'Qonex ID is required (used to derive stable leads_id).',
      rowIndex,
      originalValue: row['ID'],
    })
  }
  if (!name) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'leads_customer_name',
      message: 'Prospect name is required.',
      rowIndex,
      originalValue: row['nama_prospek'],
    })
  }
  if (!phoneResult.normalized) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'leads_customer_phone',
      message: 'Phone is required.',
      rowIndex,
      originalValue: row['nomor_telepon'],
    })
  } else if (!phoneResult.valid) {
    warnings.push({
      severity: 'WARNING',
      category: 'invalid-phone',
      field: 'leads_customer_phone',
      message: `Phone looks suspicious (${phoneResult.reason}).`,
      rowIndex,
      originalValue: row['nomor_telepon'],
      proposedValue: phoneDigits,
    })
  }
  if (!createDate.valid) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'invalid-date',
      field: 'leads_created_on',
      message: `Created timestamp could not be parsed (${createDate.reason}).`,
      rowIndex,
      originalValue: row['create'],
    })
  }
  if (!statusUpper) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'leads_status',
      message: 'Status is required.',
      rowIndex,
      originalValue: row['status'],
    })
  } else if (groupStatus === 'UNKNOWN') {
    warnings.push({
      severity: 'WARNING',
      category: 'unknown-status',
      field: 'leads_group_status',
      message: `Status "${statusUpper}" does not match NEW/FOLLOWUP/CLOSED families; stored as UNKNOWN.`,
      rowIndex,
      originalValue: statusUpper,
      proposedValue: 'UNKNOWN',
    })
  }
  if (sourceInfo.original && !sourceInfo.known) {
    warnings.push({
      severity: 'WARNING',
      category: 'unknown-source',
      field: 'leads_source',
      message: `Source "${sourceInfo.original}" is not in the CXLite taxonomy — preserved as-is.`,
      rowIndex,
      originalValue: sourceInfo.original,
      proposedValue: sourceInfo.normalized,
    })
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    warnings.push({
      severity: 'WARNING',
      category: 'invalid-type',
      field: 'leads_customer_email',
      message: 'Email format looks invalid.',
      rowIndex,
      originalValue: row['email'],
      proposedValue: email,
    })
  }
  if (noteOverflow) {
    // varchar(2000) is a hard destination constraint. Silently truncating
    // customer notes is irreversible and loses audit value, so we BLOCK
    // the row and preserve the full original text in the issue report
    // for review. The record field itself is set to NULL — if the row is
    // ever forced through, the DB sees NULL rather than a mangled note.
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'destination-constraint',
      field: 'leads_note',
      message: `Notes (${noteRaw!.length} chars) exceed varchar(${LEADS_NOTE_MAX}); irreversible truncation would occur. Shorten the source note or exclude the row.`,
      rowIndex,
      originalValue: noteRaw,
      proposedValue: null,
    })
  }

  const leadsIdSeed = `cxlite-sql:${legacyId ?? phoneDigits ?? `row-${rowIndex}`}`
  const leadsId = stableUuid(leadsIdSeed)
  // `id` follows the WA_MOBILE identifier convention (configurable prefix,
  // default `wa_<digitsPhone>`). When the phone cannot be normalized the
  // row is already blocked above; we still populate `id` with a stable
  // placeholder so the manifest can reference the blocked row.
  const id =
    parentWa ??
    `${ctx.waMobilePrefix}invalid-${stableUuid(leadsIdSeed).slice(0, 8)}`

  const createdOnUtc = createDate.utcIso
  const changedOnUtc = updatedDate.utcIso
  const nowUtc = ctx.now.toISOString()

  const provenanceUser = ctx.rowProvenanceUser ?? DEFAULT_ROW_PROVENANCE_USER

  const record: SqlRecord = {
    id,
    eventlog_id: null,
    event_name: null,
    event_time: changedOnUtc,
    leads_source: sourceInfo.normalized || sourceInfo.original || null,
    leads_parent_channel: PARENT_CHANNEL,
    leads_channel: (sourceInfo.normalized || sourceInfo.original || '').toUpperCase() || null,
    leads_parent_id: parentWa,
    leads_id: leadsId,
    leads_group_status: groupStatus,
    leads_status: statusUpper,
    leads_group_type: null,
    leads_type: null,
    leads_total_score: 0,
    leads_raw_score: '{}',
    leads_created_on: createdOnUtc,
    leads_changed_on: changedOnUtc ?? createdOnUtc,
    leads_created_by: DATA_MIGRATION_USER,
    leads_assigned_to: salesRep,
    // Audit 2026-10-13 round-2: NULL pending Ecovia confirmation of the
    // migration-marker policy on leads_assigned_by. Mirrored on sales_manager_name.
    leads_assigned_by: null,
    // NULL pending Ecovia confirmation of company mapping.
    leads_company: null,
    leads_note: noteOverflow ? null : noteRaw,
    // NULL — no Qonex field maps to CXLite qualification_level; was 'Medium'
    // placeholder in the prior round and has now been removed per the Excel.
    leads_qualification_level: null,
    leads_customer_budget: budget.numeric !== null ? String(budget.numeric) : budget.raw,
    leads_customer_name: name,
    leads_customer_email: email,
    leads_customer_phone: phoneDigits,
    leads_customer_address: trimString(row['lokasi_walkin']),
    leads_customer_ktp: '',
    // NULL pending Ecovia confirmation of project mapping.
    leads_project: null,
    leads_cluster: cluster,
    leads_urgency: DEFAULT_URGENCY,
    leads_property_price: 0,
    leads_raw_property: '{}',
    leads_financing: null,
    leads_timeline: null,
    leads_aging: 0,
    sales_id: null,
    sales_name: salesRep,
    sales_email: null,
    sales_phone: null,
    sales_manager_id: null,
    // NULL — mirrors leads_assigned_by (both pending Ecovia confirmation).
    sales_manager_name: null,
    sales_manager_phone: null,
    sales_manager_email: null,
    created_at: nowUtc,
    created_by: provenanceUser,
    updated_at: nowUtc,
    updated_by: provenanceUser,
    deleted_at: null,
    deleted_by: null,
  }

  for (const col of SQL_ANALYTIC_LEADS_SALES_COLUMNS) {
    const value = record[col.name]
    if (col.sqlType === 'varchar' && col.maxLength && !isBlank(value)) {
      const current = String(value)
      if (current.length > col.maxLength) {
        // Hard destination constraint: never silently truncate. The
        // original is preserved on the issue for review.
        blockingIssues.push({
          severity: 'BLOCKED',
          category: 'destination-constraint',
          field: col.name,
          message: `Value (${current.length} chars) exceeds varchar(${col.maxLength}); irreversible truncation would occur. Fix the source value or exclude the row.`,
          rowIndex,
          originalValue: current,
          proposedValue: null,
        })
        record[col.name] = null
      }
    }
    if (!col.nullable && (value === null || value === undefined)) {
      blockingIssues.push({
        severity: 'BLOCKED',
        category: 'missing-required',
        field: col.name,
        message: `NON-NULL SQL column ${col.name} resolved to NULL.`,
        rowIndex,
      })
    }
  }

  if (record.leads_customer_budget && String(record.leads_customer_budget).length > 100) {
    record.leads_customer_budget = String(record.leads_customer_budget).slice(0, 100)
  }

  record.leads_property_price = toInteger(record.leads_property_price) ?? 0

  issues.push(...blockingIssues, ...warnings)

  return {
    rowIndex,
    sourceId: legacyId,
    record,
    issues,
    warnings,
    blockingIssues,
    blocked: blockingIssues.length > 0,
    hash: id,
    skipped: false,
  }
}

export function buildSqlInsertStatement(columns: string[]): string {
  const placeholders = columns.map((_, i) => `@p${i + 1}`).join(', ')
  return `INSERT INTO ${SQL_TARGET_TABLE} (${columns.join(', ')}) VALUES (${placeholders});`
}

export function buildSqlPreviewStatement(
  records: SqlRecord[],
  limit = 3,
): string {
  if (records.length === 0) return '-- No rows to preview'
  const columns = SQL_ANALYTIC_LEADS_SALES_COLUMNS.map((c) => c.name)
  const parameterized = buildSqlInsertStatement(columns)
  const inlined: string[] = []
  const sample = records.slice(0, limit)
  for (const row of sample) {
    const values = columns.map((col) => formatSqlLiteral(row[col]))
    inlined.push(
      `-- parameterized (preferred):\n-- ${parameterized}\nINSERT INTO ${SQL_TARGET_TABLE} (${columns.join(', ')})\n  VALUES (${values.join(', ')});`,
    )
  }
  if (records.length > limit) {
    inlined.push(`-- …plus ${records.length - limit} more rows (not shown; DRY RUN)`)
  }
  return inlined.join('\n\n')
}

function formatSqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  return `N'${String(v).replace(/'/g, "''")}'`
}

function summarize<T>(records: Array<TransformedRecord<T>>) {
  let valid = 0
  let warning = 0
  let blocked = 0
  let duplicates = 0
  for (const r of records) {
    if (r.blocked) {
      blocked++
      if (r.blockingIssues.some((i) => i.category === 'duplicate-id')) duplicates++
    } else if (r.warnings.length > 0) {
      warning++
    } else {
      valid++
    }
  }
  return { total: records.length, valid, warning, blocked, duplicates }
}

function pushMap(map: Map<string, number[]>, key: string, value: number) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function attachBlocking<T>(
  records: Array<TransformedRecord<T>>,
  rowIndex: number,
  issue: TransformIssue,
) {
  const record = records.find((r) => r.rowIndex === rowIndex)
  if (!record) return
  if (record.blockingIssues.some((i) => i.category === issue.category && i.field === issue.field)) return
  record.blockingIssues.push(issue)
  record.issues.push(issue)
  record.blocked = true
}

function attachWarning<T>(
  records: Array<TransformedRecord<T>>,
  rowIndex: number,
  issue: TransformIssue,
) {
  const record = records.find((r) => r.rowIndex === rowIndex)
  if (!record) return
  if (record.warnings.some((i) => i.category === issue.category && i.field === issue.field)) return
  record.warnings.push(issue)
  record.issues.push(issue)
}
