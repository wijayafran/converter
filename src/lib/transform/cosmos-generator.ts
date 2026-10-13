/**
 * Qonex → CXLite Cosmos (`leads` + `leads-won`) transformer.
 *
 * Source of truth: buat-ricad §2 / §3 (not re-derived here). The transformer
 * never fabricates AI data, chat history, lead_score_* or Cosmos system
 * metadata — any field the migration cannot source authoritatively is left
 * out, exactly like production chatbot leads.
 *
 * Won snapshot invariants (strict):
 *   - 6-char `id` from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0,O,1,I)
 *   - `_partitionKey = id`
 *   - All of dealValue / project / cluster / blok / unitNumber / ktp(16d)
 *   - Written to a separate `leads-won` container
 */

import type { ParsedFile } from '@/types'
import {
  digitsPhone,
  isBlank,
  normalizeEmail,
  normalizePhone,
  parseDate,
  safeNumericString,
  trimString,
} from './primitives'
import { newRunId, stableUuid, uuidv4 } from './identifiers'
import {
  COSMOS_LEADS_CONTAINER,
  COSMOS_LEADS_WON_CONTAINER,
  COSMOS_WON_ID_CHARSET,
  COSMOS_WON_ID_LENGTH,
  COSMOS_WON_REQUIRED_FIELDS,
  DEFAULT_COSMOS_CONFIG,
  type CosmosConfig,
  type CosmosProductProfile,
} from '@/config/cosmos-mapping'
import {
  cosmosStatus,
  cxliteSource,
  DROPPED_STATUSES,
  WON_STATUSES,
} from '@/config/status-taxonomy'
import type {
  TransformContext,
  TransformIssue,
  TransformResult,
  TransformedRecord,
} from './types'

const DEAL_VALUE_MAX = 1_000_000_000_000

export interface CosmosInteraction {
  id: number
  timestamp: string
  sender: string
  message: string
  type: string
}

export interface CosmosLeadDocument {
  id: string
  _partitionKey?: string
  name: string
  customerPhone: string
  customerEmail: string | null
  phonePermission: boolean
  ktp: string
  address: string | null
  project: string
  cluster: string
  status: string
  qualificationLevel: string
  urgency: string
  source: string
  referensi: string
  productInterest: string | null
  utmCampaign: string
  customerBudget: string | null
  financing: string | null
  timeline: string | null
  notes: string | null
  company: string
  assignedTo: string
  assignedBy: string
  assignedAt: string | null
  reassignmentTriedAgents: string[]
  preferredLocation: string
  interactions: CosmosInteraction[]
  createdOn: string
  changedOn: string
  createdBy: string
  updatedBy: string
  legacyCrmId?: string
}

export interface CosmosWonDocument {
  id: string
  _partitionKey: string
  originalLeadId: string
  name: string
  project: string
  cluster: string
  blok: string
  unitNumber: string
  customerPhone: string
  customerEmail: string | null
  dealValue: string
  ktp: string
  company: string
  source: string
  originalCreatedOn: string
  originalCreatedBy: string
  status: 'Won' | 'Dropped'
  closedDate: string
  closedBy: string
  createdAt: string
  legacyCrmId?: string
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
  const seenPhoneAssigned = new Map<string, number[]>()
  const seenWonIds = new Set<string>()
  const issues: TransformIssue[] = []

  for (let i = 0; i < parsed.rows.length; i++) {
    const rowIndex = i + 1
    const row = parsed.rows[i]
    const lead = buildLeadDocument(row, rowIndex, context, config)
    leads.push(lead)
    issues.push(...lead.issues)

    if (lead.record.id) pushMap(seenIds, lead.record.id, rowIndex)
    if (lead.record.customerPhone && lead.record.assignedTo) {
      pushMap(
        seenPhoneAssigned,
        `${lead.record.customerPhone}::${lead.record.assignedTo}`,
        rowIndex,
      )
    }

    const status = lead.record.status
    if (WON_STATUSES.has(status) || DROPPED_STATUSES.has(status)) {
      const snapshot = buildWonSnapshot(row, rowIndex, lead, context, seenWonIds)
      wonSnapshots.push(snapshot)
      issues.push(...snapshot.issues)
    }
  }

  for (const [id, rows] of seenIds.entries()) {
    if (rows.length > 1) {
      const msg =
        config.profile === 'lite'
          ? `LEAD_PHONE_CONFLICT: id "${id}" repeats on rows ${rows.join(', ')} — Lite requires one lead per phone`
          : `UUID collision for stable id "${id}" on rows ${rows.join(', ')}`
      for (const r of rows) {
        attachBlocking(leads, r, {
          severity: 'BLOCKED',
          category: 'id-collision',
          field: 'id',
          message: msg,
          rowIndex: r,
          originalValue: id,
        })
      }
    }
  }

  if (config.profile === 'pro') {
    for (const [key, rows] of seenPhoneAssigned.entries()) {
      if (rows.length > 1) {
        for (const r of rows) {
          attachBlocking(leads, r, {
            severity: 'BLOCKED',
            category: 'duplicate-phone-assignee',
            field: 'customerPhone',
            message: `Pro profile forbids identical (phone, assignedTo); "${key}" repeats on rows ${rows.join(', ')}`,
            rowIndex: r,
            originalValue: key,
          })
        }
      }
    }
  }

  const summary = summarize(leads)
  const wonCount = wonSnapshots.filter(
    (w) => !w.blocked && w.record.status === 'Won',
  ).length
  const droppedCount = wonSnapshots.filter(
    (w) => !w.blocked && w.record.status === 'Dropped',
  ).length

  return {
    runId: context.runId,
    destination: 'cosmos',
    destinationLabel: 'CXLite · Cosmos DB',
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

function buildLeadDocument(
  row: Record<string, unknown>,
  rowIndex: number,
  _ctx: TransformContext,
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
  const statusInfo = cosmosStatus(row['status'])
  const sourceInfo = cxliteSource(row['source_data'])
  const company = trimString(row['group']) ?? config.defaultCompany ?? null

  if (!name) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'name',
      message: 'name is required.',
      rowIndex,
      originalValue: row['nama_prospek'],
    })
  }
  if (!phoneResult.normalized) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'customerPhone',
      message: 'customerPhone is required (Lite uses it as id).',
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
      proposedValue: digitsPhone(phoneResult),
    })
  }
  if (!createdBy) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'createdBy',
      message: 'createdBy is required.',
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
  if (!company) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'company',
      message:
        'company is required (must resolve in the `companies` container; pass defaultCompany on migration if missing).',
      rowIndex,
      originalValue: row['group'],
    })
  }
  if (!sourceInfo.original) {
    blockingIssues.push({
      severity: 'BLOCKED',
      category: 'missing-required',
      field: 'source',
      message: 'source is required.',
      rowIndex,
      originalValue: row['source_data'],
    })
  } else if (!sourceInfo.known) {
    warnings.push({
      severity: 'WARNING',
      category: 'unknown-source',
      field: 'source',
      message: `Source "${sourceInfo.original}" is not in the CXLite taxonomy — will render as "Other" in filters.`,
      rowIndex,
      originalValue: sourceInfo.original,
      proposedValue: sourceInfo.normalized,
    })
  }
  if (statusInfo.original && !statusInfo.known) {
    warnings.push({
      severity: 'WARNING',
      category: 'unknown-status',
      field: 'status',
      message: `Status "${statusInfo.original}" is not a CXLite status — preserved as-is.`,
      rowIndex,
      originalValue: statusInfo.original,
      proposedValue: statusInfo.normalized,
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

  const phoneDigits = digitsPhone(phoneResult)
  let id: string
  if (config.profile === 'lite') {
    id = phoneDigits ? `${config.waMobilePrefix}${phoneDigits}` : `${config.waMobilePrefix}invalid-${rowIndex}`
  } else {
    id = legacyId ? stableUuid(`cxlite:${legacyId}`) : uuidv4()
  }

  const sourceValue = sourceInfo.normalized || sourceInfo.original || ''
  const partitionHint = sourceValue.toLowerCase() || undefined

  const assignedAtIso = createDate.utcIso
  const document: CosmosLeadDocument = {
    id,
    _partitionKey: partitionHint,
    name: name ?? '',
    customerPhone: phoneDigits ?? '',
    customerEmail: email ?? null,
    phonePermission: true,
    ktp: '',
    address: null,
    project: trimString(row['group']) ?? '',
    cluster: trimString(row['cluster']) ?? '',
    status: statusInfo.normalized || 'New',
    qualificationLevel: 'Medium',
    urgency: 'Medium',
    source: sourceValue,
    referensi: '',
    productInterest: null,
    utmCampaign: '',
    customerBudget:
      safeNumericString(row['type_price']).numeric !== null
        ? String(safeNumericString(row['type_price']).numeric)
        : null,
    financing: null,
    timeline: null,
    notes: trimString(row['keterangan']),
    company: company ?? '',
    assignedTo: createdBy ?? '',
    assignedBy: createdBy ?? '',
    assignedAt: assignedAtIso,
    reassignmentTriedAgents: [],
    preferredLocation: trimString(row['lokasi_walkin']) ?? '',
    interactions: [],
    createdOn: createDate.utcIso ?? '',
    changedOn: changedDate.utcIso ?? createDate.utcIso ?? '',
    createdBy: createdBy ?? '',
    updatedBy: createdBy ?? '',
    legacyCrmId: legacyId ?? undefined,
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
    hash: id,
    skipped: false,
  }
}

function buildWonSnapshot(
  row: Record<string, unknown>,
  rowIndex: number,
  lead: TransformedRecord<CosmosLeadDocument>,
  _ctx: TransformContext,
  seenWonIds: Set<string>,
): TransformedRecord<CosmosWonDocument> {
  const issues: TransformIssue[] = []
  const warnings: TransformIssue[] = []
  const blockingIssues: TransformIssue[] = []
  const kind: 'Won' | 'Dropped' = WON_STATUSES.has(lead.record.status) ? 'Won' : 'Dropped'

  const dealRaw = safeNumericString(row['deal_value'] ?? row['won_deal_value'])
  const ktpRaw = trimString(row['ktp']) ?? ''
  const project = trimString(row['project']) ?? trimString(row['group']) ?? ''
  const cluster = trimString(row['cluster']) ?? ''
  const blok = trimString(row['block'] ?? row['blok']) ?? ''
  const unitNumber = trimString(row['unit_number'] ?? row['unit_no']) ?? ''
  const closedDate = parseDate(row['closed_on'] ?? row['last_update'])
  const closedBy = trimString(row['closed_by']) ?? lead.record.assignedTo

  if (kind === 'Won') {
    if (dealRaw.numeric === null || dealRaw.numeric <= 0) {
      blockingIssues.push({
        severity: 'BLOCKED',
        category: 'missing-won-field',
        field: 'dealValue',
        message: 'Won lead is missing dealValue (digits only, > 0).',
        rowIndex,
      })
    } else if (dealRaw.numeric > DEAL_VALUE_MAX) {
      blockingIssues.push({
        severity: 'BLOCKED',
        category: 'destination-constraint',
        field: 'dealValue',
        message: `dealValue ${dealRaw.numeric} exceeds the 1 trillion IDR cap.`,
        rowIndex,
      })
    }
    if (!/^\d{16}$/.test(ktpRaw)) {
      blockingIssues.push({
        severity: 'BLOCKED',
        category: 'missing-won-field',
        field: 'ktp',
        message: 'Won lead requires exactly 16 digits KTP.',
        rowIndex,
      })
    }
    if (project.length < 2 || project.length > 100) {
      blockingIssues.push({
        severity: 'BLOCKED',
        category: 'missing-won-field',
        field: 'project',
        message: 'Won lead project must be 2-100 chars.',
        rowIndex,
      })
    }
    if (cluster.length < 2 || cluster.length > 100) {
      blockingIssues.push({
        severity: 'BLOCKED',
        category: 'missing-won-field',
        field: 'cluster',
        message: 'Won lead cluster must be 2-100 chars.',
        rowIndex,
      })
    }
    if (blok.length < 1 || blok.length > 50) {
      blockingIssues.push({
        severity: 'BLOCKED',
        category: 'missing-won-field',
        field: 'blok',
        message: 'Won lead blok must be 1-50 chars.',
        rowIndex,
      })
    }
    if (unitNumber.length < 1 || unitNumber.length > 50) {
      blockingIssues.push({
        severity: 'BLOCKED',
        category: 'missing-won-field',
        field: 'unitNumber',
        message: 'Won lead unitNumber must be 1-50 chars.',
        rowIndex,
      })
    }
  }

  const closedDateIso = closedDate.utcIso ?? _ctx.now.toISOString()
  const id = generateWonId(`${lead.record.id}:${kind}`, seenWonIds)
  seenWonIds.add(id)

  const document: CosmosWonDocument = {
    id,
    _partitionKey: id,
    originalLeadId: lead.record.id,
    name: lead.record.name,
    project,
    cluster,
    blok,
    unitNumber,
    customerPhone: lead.record.customerPhone,
    customerEmail: lead.record.customerEmail,
    dealValue: dealRaw.numeric !== null ? String(dealRaw.numeric) : '0',
    ktp: ktpRaw,
    company: lead.record.company,
    source: lead.record.source,
    originalCreatedOn: lead.record.createdOn,
    originalCreatedBy: lead.record.createdBy,
    status: kind,
    closedDate: closedDateIso,
    closedBy,
    createdAt: closedDateIso,
    legacyCrmId: lead.sourceId ?? undefined,
  }

  // Mirror the Won core fields back onto the lead document per spec (§3.3).
  if (kind === 'Won') {
    lead.record.ktp = ktpRaw
    lead.record.project = project || lead.record.project
    lead.record.cluster = cluster || lead.record.cluster
    lead.record.customerBudget = document.dealValue
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
    hash: id,
    skipped: false,
  }
}

function generateWonId(seed: string, seen: Set<string>): string {
  const base = stableUuid(seed).replace(/-/g, '').toUpperCase()
  const chars = COSMOS_WON_ID_CHARSET
  let candidate = ''
  for (let i = 0; i < COSMOS_WON_ID_LENGTH; i++) {
    const n = parseInt(base.substr(i * 2, 2), 16)
    candidate += chars[n % chars.length]
  }
  if (!seen.has(candidate)) return candidate
  let salt = 1
  while (seen.has(`${candidate}-${salt}`)) salt++
  const resalted = stableUuid(`${seed}:${salt}`).replace(/-/g, '').toUpperCase()
  let next = ''
  for (let i = 0; i < COSMOS_WON_ID_LENGTH; i++) {
    const n = parseInt(resalted.substr(i * 2, 2), 16)
    next += chars[n % chars.length]
  }
  return next
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

/** Build a flat JSON array suitable for Cosmos bulk ops. */
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

export { COSMOS_WON_REQUIRED_FIELDS }
