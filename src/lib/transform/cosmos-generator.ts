/**
 * Qonex → LEMONS / Cosmos DB transformer.
 *
 * Produces documents for TWO containers:
 *   - `leads`      : live leads
 *   - `leads-won`  : won / dropped snapshots (originalLeadId FK)
 *
 * Both containers use `/id` as the partition key.
 *
 * The transformer deliberately does NOT fabricate chat history, interactions,
 * assignment history, AI scoring, customer consent, or Cosmos system
 * metadata. Where the mapping contract calls for an array, we emit `[]` and
 * where it calls for an optional object, we omit it entirely.
 *
 * Required Won fields (dealValue, KTP, project, cluster, block, unitNumber)
 * are strict: if any is missing, the Won lead is BLOCKED (never downgraded).
 */

import type { ParsedFile } from '@/types'
import {
  isBlank,
  normalizeEmail,
  normalizePhone,
  parseDate,
  safeNumericString,
  toDecimal,
  toInteger,
  trimString,
} from './primitives'
import { newRunId, stableUuid, uuidv4 } from './identifiers'
import {
  COSMOS_LEADS_CONTAINER,
  COSMOS_LEADS_WON_CONTAINER,
  COSMOS_WON_REQUIRED_FIELDS,
  DEFAULT_COSMOS_CONFIG,
  type CosmosConfig,
  type CosmosProductProfile,
} from '@/config/cosmos-mapping'
import { mapSource, mapStatus, DROPPED_STATUSES, WON_STATUSES } from '@/config/status-taxonomy'
import type {
  TransformContext,
  TransformIssue,
  TransformResult,
  TransformedRecord,
} from './types'

const SOURCE_SYSTEM = 'QONEX'
const MIGRATION_MARKER = 'MIGRATION_V1'

export interface CosmosLeadDocument {
  id: string
  legacyCrmId: string | null
  name: string | null
  customerPhone: string | null
  customerEmail?: string | null
  company?: string | null
  source: string | null
  sourceCategory?: string | null
  status: string | null
  createdOn: string | null
  changedOn?: string | null
  createdBy: string | null
  assignedTo?: string | null
  interestType?: string | null
  priceTier?: string | null
  priceNumeric?: number | null
  project?: {
    cluster?: string | null
    block?: string | null
    unitNumber?: string | null
    name?: string | null
  }
  geo?: {
    lat: number | null
    lng: number | null
  }
  engagement?: {
    whatsappCount?: number | null
    callCount?: number | null
    firstContactAt?: string | null
    lastVisitAt?: string | null
  }
  notes?: string | null
  interactions: unknown[]
  chatHistory: unknown[]
  assignmentHistory: unknown[]
  sourceSystem: string
  migrationRunId: string
  migrationBatchId: string
  migrationMarker: string
  migrationDryRun: boolean
  migratedAt: string
}

export interface CosmosWonDocument extends CosmosLeadDocument {
  originalLeadId: string
  deal: {
    value: number
    currency: string
  }
  ktp: string
  closedOn: string | null
  snapshotKind: 'won' | 'dropped'
}

export interface CosmosTransformOptions {
  runId?: string
  dryRun?: boolean
  now?: Date
  config?: CosmosConfig
}

export interface CosmosTransformResult {
  runId: string
  destination: 'cosmos'
  destinationLabel: string
  profile: CosmosProductProfile
  transformedAt: string
  leads: Array<TransformedRecord<CosmosLeadDocument>>
  wonSnapshots: Array<TransformedRecord<CosmosWonDocument>>
  issues: TransformIssue[]
  summary: TransformResult<CosmosLeadDocument>['summary'] & {
    wonCount: number
    droppedCount: number
    containers: {
      [COSMOS_LEADS_CONTAINER]: number
      [COSMOS_LEADS_WON_CONTAINER]: number
    }
  }
}

export function transformToCosmos(
  parsed: ParsedFile,
  options: CosmosTransformOptions = {},
): CosmosTransformResult {
  const config = options.config ?? DEFAULT_COSMOS_CONFIG
  const context: TransformContext = {
    runId: options.runId ?? newRunId('COS'),
    dryRun: options.dryRun ?? true,
    waMobilePrefix: config.waMobilePrefix,
    now: options.now ?? new Date(),
  }

  const leads: Array<TransformedRecord<CosmosLeadDocument>> = []
  const wonSnapshots: Array<TransformedRecord<CosmosWonDocument>> = []
  const seenIds = new Map<string, number[]>()
  const seenPhoneAssignedTo = new Map<string, number[]>()
  const issues: TransformIssue[] = []

  for (let i = 0; i < parsed.rows.length; i++) {
    const rowIndex = i + 1
    const row = parsed.rows[i]
    const lead = transformOneCosmosLead(row, rowIndex, context, config)
    leads.push(lead)
    issues.push(...lead.issues)

    const id = lead.record.id
    if (id) pushMap(seenIds, id, rowIndex)

    if (
      lead.record.customerPhone &&
      lead.record.assignedTo
    ) {
      pushMap(
        seenPhoneAssignedTo,
        `${lead.record.customerPhone}::${lead.record.assignedTo}`,
        rowIndex,
      )
    }

    const normalizedStatus = lead.record.status ?? ''
    if (WON_STATUSES.has(normalizedStatus) || DROPPED_STATUSES.has(normalizedStatus)) {
      const snapshot = transformWonSnapshot(row, rowIndex, lead, context)
      wonSnapshots.push(snapshot)
      issues.push(...snapshot.issues)
    }
  }

  for (const [id, rows] of seenIds.entries()) {
    if (rows.length > 1) {
      for (const r of rows) {
        attachBlocking(leads, r, {
          severity: 'BLOCKED',
          category: 'id-collision',
          field: 'id',
          message:
            config.profile === 'lite'
              ? `Phone collision on wa_<phone> ID "${id}" (rows ${rows.join(', ')}). In Lite profile each phone must map to exactly one lead.`
              : `UUID collision on "${id}" (rows ${rows.join(', ')}) — upstream legacy IDs collide for the stable-UUID derivation.`,
          rowIndex: r,
          originalValue: id,
        })
      }
    }
  }

  if (config.profile === 'pro') {
    for (const [key, rows] of seenPhoneAssignedTo.entries()) {
      if (rows.length > 1) {
        for (const r of rows) {
          attachWarning(leads, r, {
            severity: 'WARNING',
            category: 'duplicate-phone-assignee',
            field: 'customerPhone',
            message: `Phone+assignedTo pair "${key}" repeats on rows ${rows.join(', ')} — Pro duplicate policy requires a business decision.`,
            rowIndex: r,
            originalValue: key,
          })
        }
      }
    }
  }

  const summary = summarize(leads)
  const wonCount = wonSnapshots.filter(
    (w) => !w.blocked && w.record.snapshotKind === 'won',
  ).length
  const droppedCount = wonSnapshots.filter(
    (w) => !w.blocked && w.record.snapshotKind === 'dropped',
  ).length

  return {
    runId: context.runId,
    destination: 'cosmos',
    destinationLabel: 'LEMONS / Cosmos DB',
    profile: config.profile,
    transformedAt: context.now.toISOString(),
    leads,
    wonSnapshots,
    issues,
    summary: {
      ...summary,
      wonCount,
      droppedCount,
      containers: {
        [COSMOS_LEADS_CONTAINER]: leads.filter((l) => !l.blocked).length,
        [COSMOS_LEADS_WON_CONTAINER]: wonSnapshots.filter((w) => !w.blocked).length,
      },
    },
  }
}

function transformOneCosmosLead(
  row: Record<string, unknown>,
  rowIndex: number,
  ctx: TransformContext,
  config: CosmosConfig,
): TransformedRecord<CosmosLeadDocument> {
  const issues: TransformIssue[] = []
  const warnings: TransformIssue[] = []
  const blockingIssues: TransformIssue[] = []

  const legacyId = trimString(row['ID'])
  const name = trimString(row['nama_prospek'])
  const phoneResult = normalizePhone(row['nomor_telepon'])
  const email = normalizeEmail(row['email'])
  const createdBy = trimString(row['sales_rep'])
  const createDate = parseDate(row['create'])
  const changedDate = parseDate(row['last_update'])
  const firstContact = parseDate(row['first_contact'])
  const lastVisit = parseDate(row['visit_at'])
  const lat = toDecimal(row['lat'], 6)
  const long = toDecimal(row['long'], 6)
  const price = safeNumericString(row['type_price'])
  const statusInfo = mapStatus('cosmos', row['status'])
  const sourceInfo = mapSource(row['source_data'])
  const company = trimString(row['group'])

  if (!name) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'name',
      message: 'Prospect name is required.',
      rowIndex,
      originalValue: row['nama_prospek'],
    })
  }
  if (!phoneResult.normalized) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'customerPhone',
      message: 'Phone is required (used as the Lite profile partition key).',
      rowIndex,
      originalValue: row['nomor_telepon'],
    })
  } else if (!phoneResult.valid) {
    warnings.push({
      severity: 'WARNING',
      category: 'invalid-phone',
      field: 'customerPhone',
      message: `Phone looks suspicious (${phoneResult.reason}).`,
      rowIndex,
      originalValue: row['nomor_telepon'],
      proposedValue: phoneResult.normalized,
    })
  }
  if (!createdBy) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'createdBy',
      message: 'createdBy (sales rep) is required.',
      rowIndex,
      originalValue: row['sales_rep'],
    })
  }
  if (!createDate.valid) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'invalid-date',
      field: 'createdOn',
      message: `createdOn could not be parsed (${createDate.reason}).`,
      rowIndex,
      originalValue: row['create'],
    })
  }
  if (!statusInfo.original) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'status',
      message: 'Status is required.',
      rowIndex,
      originalValue: row['status'],
    })
  } else if (!statusInfo.known) {
    warnings.push({
      severity: 'WARNING',
      category: 'unknown-status',
      field: 'status',
      message: `Unknown status "${statusInfo.original}" — preserved as-is.`,
      rowIndex,
      originalValue: statusInfo.original,
      proposedValue: statusInfo.normalized,
    })
  }
  if (!sourceInfo.original) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'source',
      message: 'Source is required.',
      rowIndex,
      originalValue: row['source_data'],
    })
  } else if (!sourceInfo.known) {
    warnings.push({
      severity: 'WARNING',
      category: 'unknown-source',
      field: 'source',
      message: `Unknown source "${sourceInfo.original}" — preserved as-is.`,
      rowIndex,
      originalValue: sourceInfo.original,
      proposedValue: sourceInfo.normalized,
    })
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    warnings.push({
      severity: 'WARNING',
      category: 'invalid-type',
      field: 'customerEmail',
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
      field: 'geo',
      message: 'Latitude or longitude rounded to 6 decimals.',
      rowIndex,
    })
  }

  let id: string
  if (config.profile === 'lite') {
    if (phoneResult.valid && phoneResult.normalized) {
      id = `${config.waMobilePrefix}${phoneResult.normalized.replace(/^\+/, '')}`
    } else {
      id = `${config.waMobilePrefix}invalid-${rowIndex}`
    }
  } else {
    id = legacyId ? stableUuid(`cosmos:${legacyId}`) : uuidv4()
  }

  const assignedTo = createdBy
  const document: CosmosLeadDocument = {
    id,
    legacyCrmId: legacyId,
    name,
    customerPhone: phoneResult.normalized,
    customerEmail: email ?? null,
    company,
    source: sourceInfo.normalized || null,
    sourceCategory: trimString(row['category_source']),
    status: statusInfo.normalized || null,
    createdOn: createDate.utcIso,
    changedOn: changedDate.utcIso,
    createdBy,
    assignedTo,
    interestType: trimString(row['interest_type']),
    priceTier: price.raw,
    priceNumeric: price.numeric,
    project: {
      cluster: trimString(row['cluster']),
    },
    geo:
      lat.value !== null || long.value !== null
        ? { lat: lat.value, lng: long.value }
        : undefined,
    engagement: {
      whatsappCount: toInteger(row['total_wa']),
      callCount: toInteger(row['total_call']),
      firstContactAt: firstContact.utcIso,
      lastVisitAt: lastVisit.utcIso,
    },
    notes: trimString(row['keterangan']),
    interactions: [],
    chatHistory: [],
    assignmentHistory: [],
    sourceSystem: SOURCE_SYSTEM,
    migrationRunId: ctx.runId,
    migrationBatchId: `${ctx.runId}-B001`,
    migrationMarker: MIGRATION_MARKER,
    migrationDryRun: ctx.dryRun,
    migratedAt: ctx.now.toISOString(),
  }

  issues.push(...blockingIssues, ...warnings)

  return {
    rowIndex,
    sourceId: legacyId,
    record: document,
    issues,
    warnings,
    blockingIssues,
    blocked: blockingIssues.length > 0,
    hash: stableUuid(
      `${document.legacyCrmId ?? ''}:${document.customerPhone ?? ''}:${document.createdOn ?? ''}`,
    ),
    skipped: false,
  }
}

function transformWonSnapshot(
  row: Record<string, unknown>,
  rowIndex: number,
  lead: TransformedRecord<CosmosLeadDocument>,
  ctx: TransformContext,
): TransformedRecord<CosmosWonDocument> {
  const issues: TransformIssue[] = []
  const warnings: TransformIssue[] = []
  const blockingIssues: TransformIssue[] = []
  const kind: 'won' | 'dropped' = WON_STATUSES.has(lead.record.status ?? '')
    ? 'won'
    : 'dropped'

  const dealRaw = safeNumericString(row['deal_value'] ?? row['won_deal_value'])
  const ktp = trimString(row['ktp'])
  const project = trimString(row['project'])
  const cluster = trimString(row['cluster'])
  const block = trimString(row['block'])
  const unitNumber = trimString(row['unit_number'] ?? row['unit_no'])
  const closedOnDate = parseDate(row['closed_on'] ?? row['last_update'])

  if (kind === 'won') {
    const missing: string[] = []
    if (dealRaw.numeric === null) missing.push('dealValue')
    if (!ktp) missing.push('ktp')
    if (!project) missing.push('project')
    if (!cluster) missing.push('cluster')
    if (!block) missing.push('block')
    if (!unitNumber) missing.push('unitNumber')
    for (const field of missing) {
      blockingIssues.push({
        severity: 'BLOCKED',
        category: 'missing-won-field',
        field,
        message: `Won lead is missing required field "${field}". Cosmos leads-won snapshot will NOT be fabricated.`,
        rowIndex,
      })
    }
    if (missing.length > 0 && missing.length < COSMOS_WON_REQUIRED_FIELDS.length) {
      warnings.push({
        severity: 'WARNING',
        category: 'partial-won',
        field: 'won-snapshot',
        message: `Partial Won data: ${missing.join(', ')} missing. Resolve upstream before including in a real run.`,
        rowIndex,
      })
    }
  }

  const document: CosmosWonDocument = {
    ...lead.record,
    id: `${lead.record.id}:${kind}`,
    originalLeadId: lead.record.id,
    deal: {
      value: dealRaw.numeric ?? 0,
      currency: 'IDR',
    },
    ktp: ktp ?? '',
    closedOn: closedOnDate.utcIso,
    snapshotKind: kind,
    project: {
      ...lead.record.project,
      name: project ?? lead.record.project?.name ?? null,
      cluster: cluster ?? lead.record.project?.cluster ?? null,
      block: block ?? null,
      unitNumber: unitNumber ?? null,
    },
    migratedAt: ctx.now.toISOString(),
  }

  issues.push(...blockingIssues, ...warnings)

  return {
    rowIndex,
    sourceId: lead.sourceId,
    record: document,
    issues,
    warnings,
    blockingIssues,
    blocked: blockingIssues.length > 0,
    hash: stableUuid(`won:${document.originalLeadId}:${kind}`),
    skipped: false,
  }
}

function summarize<T>(records: Array<TransformedRecord<T>>) {
  let valid = 0
  let warning = 0
  let blocked = 0
  let duplicates = 0
  for (const r of records) {
    if (r.blocked) {
      blocked++
      if (r.blockingIssues.some((i) => i.category === 'id-collision')) duplicates++
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
  const r = records.find((x) => x.rowIndex === rowIndex)
  if (!r) return
  if (r.blockingIssues.some((i) => i.category === issue.category && i.field === issue.field)) return
  r.blockingIssues.push(issue)
  r.issues.push(issue)
  r.blocked = true
}

function attachWarning<T>(
  records: Array<TransformedRecord<T>>,
  rowIndex: number,
  issue: TransformIssue,
) {
  const r = records.find((x) => x.rowIndex === rowIndex)
  if (!r) return
  if (r.warnings.some((i) => i.category === issue.category && i.field === issue.field)) return
  r.warnings.push(issue)
  r.issues.push(issue)
}

/**
 * Build a flat JSON array suitable for Cosmos SDK `createItem`/bulk ops. Each
 * element is `{ container, body, partitionKey }` so the adapter can route by
 * container without a second pass. We never upload the array itself; this is
 * the preview payload for the UI and tests.
 */
export function buildCosmosBatchArray(
  result: CosmosTransformResult,
): Array<{ container: string; partitionKey: string; body: unknown }> {
  const out: Array<{ container: string; partitionKey: string; body: unknown }> = []
  for (const lead of result.leads) {
    if (lead.blocked || isBlank(lead.record.id)) continue
    out.push({
      container: COSMOS_LEADS_CONTAINER,
      partitionKey: lead.record.id,
      body: lead.record,
    })
  }
  for (const won of result.wonSnapshots) {
    if (won.blocked || isBlank(won.record.id)) continue
    out.push({
      container: COSMOS_LEADS_WON_CONTAINER,
      partitionKey: won.record.id,
      body: won.record,
    })
  }
  return out
}
