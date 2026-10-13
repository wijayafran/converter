/**
 * Qonex → dev_analytic_cxlite.analytic_leads_sales transformer.
 *
 * Produces one snapshot row per lead (initial-snapshot POC — no event history
 * is generated and no `eventlog` is populated). The transformer is pure: no
 * database access, no network, no side effects beyond building objects. The
 * accompanying adapter (`src/lib/adapters/sql-adapter.ts`) is responsible for
 * eventually turning these objects into real INSERTs.
 */

import type { ParsedFile } from '@/types'
import {
  clampVarchar,
  isBlank,
  normalizeEmail,
  normalizePhone,
  parseDate,
  safeNumericString,
  toBoolean,
  toDecimal,
  toInteger,
  trimString,
  waMobileId,
} from './primitives'
import { newRunId, stableHashId, stableUuid } from './identifiers'
import {
  SQL_ANALYTIC_LEADS_SALES_COLUMNS,
  SQL_TARGET_TABLE,
} from '@/config/sql-mapping'
import { mapStatus } from '@/config/status-taxonomy'
import type {
  TransformContext,
  TransformIssue,
  TransformResult,
  TransformedRecord,
} from './types'

const DRY_RUN_MARKER = 'MIGRATION_V1'
const SOURCE_SYSTEM = 'QONEX'

export interface SqlRecord {
  [column: string]: string | number | boolean | null
}

export interface SqlTransformOptions {
  runId?: string
  waMobilePrefix?: string
  dryRun?: boolean
  now?: Date
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
  }

  const records: Array<TransformedRecord<SqlRecord>> = []
  const seenLegacyIds = new Map<string, number[]>()
  const seenPhones = new Map<string, number[]>()
  const seenLeadsIds = new Map<string, number[]>()
  const allIssues: TransformIssue[] = []

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]
    const rowIndex = i + 1
    const transformed = transformOneSqlRow(row, rowIndex, context)
    records.push(transformed)
    allIssues.push(...transformed.issues)

    const legacy = transformed.record.leads_legacy_id as string | null
    if (legacy) pushMap(seenLegacyIds, legacy, rowIndex)
    const phone = transformed.record.leads_customer_phone as string | null
    if (phone) pushMap(seenPhones, phone, rowIndex)
    const id = transformed.record.leads_id as string | null
    if (id) pushMap(seenLeadsIds, id, rowIndex)
  }

  for (const [id, rows] of seenLegacyIds.entries()) {
    if (rows.length > 1) {
      for (const r of rows) {
        attachBlocking(records, r, {
          severity: 'BLOCKED',
          category: 'duplicate-id',
          field: 'leads_legacy_id',
          message: `Duplicate legacy ID "${id}" appears on rows ${rows.join(', ')}`,
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
          message: `Duplicate stable UUID "${id}" generated for rows ${rows.join(', ')} (upstream legacy IDs collide)`,
          rowIndex: r,
          originalValue: id,
        })
      }
    }
  }
  for (const [phone, rows] of seenPhones.entries()) {
    if (rows.length > 1) {
      for (const r of rows) {
        attachWarning(records, r, {
          severity: 'WARNING',
          category: 'duplicate-phone',
          field: 'leads_customer_phone',
          message: `Phone ${phone} appears on rows ${rows.join(', ')} — business must decide duplicate policy`,
          rowIndex: r,
          originalValue: phone,
        })
      }
    }
  }

  const summary = summarize(records)

  return {
    runId: context.runId,
    destination: 'sql',
    destinationLabel: 'SQL Server · analytic_leads_sales',
    transformedAt: context.now.toISOString(),
    records,
    issues: allIssues,
    summary,
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
  const nextActionDate = parseDate(row['next_action'])
  const firstContactDate = parseDate(row['first_contact'])
  const visitAtDate = parseDate(row['visit_at'])
  const lat = toDecimal(row['lat'], 6)
  const long = toDecimal(row['long'], 6)
  const booked = toBoolean(row['bookmark'])
  const price = safeNumericString(row['type_price'])
  const groupVal = trimString(row['group'])
  const notes = clampVarchar(row['keterangan'], 4000)
  const statusInfo = mapStatus('sql', row['status'])

  if (!legacyId) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'leads_legacy_id',
      message: 'Qonex ID is required.',
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
      proposedValue: phoneResult.normalized,
    })
  }
  if (!salesRep) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'leads_sales_rep',
      message: 'Sales rep is required (analytic model expects assigned owner).',
      rowIndex,
      originalValue: row['sales_rep'],
    })
  }
  if (!createDate.valid) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'invalid-date',
      field: 'leads_created_at',
      message: `Created timestamp could not be parsed (${createDate.reason}).`,
      rowIndex,
      originalValue: row['create'],
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
  if (lat.precisionLoss || long.precisionLoss) {
    warnings.push({
      severity: 'WARNING',
      category: 'precision-loss',
      field: lat.precisionLoss ? 'leads_latitude' : 'leads_longitude',
      message: 'Geographic coordinate rounded to DECIMAL(9,6).',
      rowIndex,
      originalValue: lat.precisionLoss ? row['lat'] : row['long'],
      proposedValue: lat.precisionLoss ? lat.value : long.value,
    })
  }
  if (!statusInfo.known && statusInfo.original) {
    warnings.push({
      severity: 'WARNING',
      category: 'unknown-status',
      field: 'leads_status',
      message: `Unknown status "${statusInfo.original}" — preserved as-is.`,
      rowIndex,
      originalValue: statusInfo.original,
      proposedValue: statusInfo.normalized,
    })
  } else if (!statusInfo.original) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'leads_status',
      message: 'Status is required.',
      rowIndex,
      originalValue: row['status'],
    })
  }
  if (notes.truncated) {
    warnings.push({
      severity: 'WARNING',
      category: 'destination-constraint',
      field: 'leads_notes',
      message: 'Notes exceeded 4000 chars and were truncated for safety.',
      rowIndex,
      originalValue: String(row['keterangan']).slice(0, 50) + '…',
      proposedValue: notes.value,
    })
  }

  const leadsIdSeed = `${legacyId ?? phoneResult.normalized ?? `row-${rowIndex}`}:${SOURCE_SYSTEM}`
  const leadsId = stableUuid(leadsIdSeed)
  const waMobile = waMobileId(phoneResult, ctx.waMobilePrefix)

  const createdAtUtc = createDate.utcIso
  const createdAtWib = createDate.jakartaIso

  const record: SqlRecord = {
    leads_id: leadsId,
    leads_legacy_id: legacyId,
    leads_wa_mobile: waMobile,
    leads_customer_name: name,
    leads_customer_phone: phoneResult.normalized,
    leads_customer_email: email,
    leads_status: statusInfo.normalized || null,
    leads_status_detail: statusInfo.original,
    leads_sub_status: trimString(row['cancel_reason']),
    leads_cancel_reason: trimString(row['cancel_reason']),
    leads_interest_type: trimString(row['interest_type']),
    leads_price_tier: price.raw,
    leads_price_numeric: price.numeric,
    leads_source: trimString(row['source_data']),
    leads_source_category: trimString(row['category_source']),
    leads_exhibition_location: trimString(row['lokasi_pameran']),
    leads_walkin_location: trimString(row['lokasi_walkin']),
    leads_cluster: trimString(row['cluster']),
    leads_group: groupVal,
    leads_company: groupVal,
    leads_sales_rep: salesRep,
    leads_sales_rep_id: null,
    leads_assigned_to: salesRep,
    leads_notes: notes.value,
    leads_next_action: trimString(row['next_action']),
    leads_created_at: createdAtUtc,
    leads_created_at_wib: createdAtWib,
    leads_updated_at: updatedDate.utcIso,
    leads_next_action_at: nextActionDate.utcIso,
    leads_first_contact_at: firstContactDate.utcIso,
    leads_last_visit_at: visitAtDate.utcIso,
    leads_latitude: lat.value,
    leads_longitude: long.value,
    leads_attachment_url: trimString(row['attachment']),
    leads_bookmark: booked,
    leads_progress_count: toInteger(row['total_progress']),
    leads_wa_count: toInteger(row['total_wa']),
    leads_call_count: toInteger(row['total_call']),
    leads_aging: 0,
    leads_ad_name: trimString(row['ad_name']),
    leads_adset_name: trimString(row['adset_name']),
    leads_form_name: trimString(row['form_name']),
    leads_campaign_name: trimString(row['campaign_name']),
    leads_source_system: SOURCE_SYSTEM,
    leads_migration_run_id: ctx.runId,
    leads_migration_batch_id: `${ctx.runId}-B001`,
    leads_migration_source_row: rowIndex,
    leads_migration_marker: DRY_RUN_MARKER,
    leads_migration_dry_run: ctx.dryRun,
    leads_migrated_at: ctx.now.toISOString(),
    leads_hash: '',
  }

  for (const col of SQL_ANALYTIC_LEADS_SALES_COLUMNS) {
    if (col.sqlType === 'NVARCHAR' && col.maxLength && !isBlank(record[col.name])) {
      const current = String(record[col.name])
      if (current.length > col.maxLength) {
        warnings.push({
          severity: 'WARNING',
          category: 'destination-constraint',
          field: col.name,
          message: `Value exceeds NVARCHAR(${col.maxLength}); truncated.`,
          rowIndex,
          originalValue: current,
          proposedValue: current.slice(0, col.maxLength),
        })
        record[col.name] = current.slice(0, col.maxLength)
      }
    }
    if (!col.nullable && (record[col.name] === null || record[col.name] === undefined)) {
      blockingIssues.push({
        severity: 'BLOCKED',
        category: 'missing-required',
        field: col.name,
        message: `Non-null SQL column ${col.name} resolved to NULL.`,
        rowIndex,
      })
    }
  }

  const hashInput = JSON.stringify({
    legacyId: record.leads_legacy_id,
    phone: record.leads_customer_phone,
    name: record.leads_customer_name,
    createdAt: record.leads_created_at,
    status: record.leads_status,
  })
  record.leads_hash = stableHashId(hashInput)

  issues.push(...blockingIssues, ...warnings)

  return {
    rowIndex,
    sourceId: legacyId,
    record,
    issues,
    warnings,
    blockingIssues,
    blocked: blockingIssues.length > 0,
    hash: record.leads_hash as string,
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
