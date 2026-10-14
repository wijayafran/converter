/**
 * Read-only reconciliation between a prior `sql-leads-dry-run.json` export
 * and what the current (Phase 2C) mapping engine would produce.
 *
 * The script NEVER:
 *   - connects to SQL Server,
 *   - reads from the local database,
 *   - inserts, updates, deletes, or truncates any record.
 *
 * It inspects the exported JSON for fingerprints of the pre-Phase-2C
 * generator and reports, per record, which fields would differ if the
 * same Qonex Excel were re-transformed today. The original database rows
 * remain untouched — this is a diff *of expected outputs*, not of the DB.
 *
 * Usage:
 *   npm run reconcile:dry-run                        # looks for ./sql-leads-dry-run.json
 *   npm run reconcile:dry-run -- --prior path.json   # explicit path
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  resolveQonexSource,
  resolveQonexStatus,
} from '@/config/status-taxonomy'

interface PriorRecord {
  id?: string
  leads_source?: string | null
  leads_channel?: string | null
  leads_status?: string | null
  leads_group_status?: string | null
  leads_urgency?: string | null
  leads_qualification_level?: string | null
  leads_company?: string | null
  leads_project?: string | null
  leads_assigned_by?: string | null
  sales_manager_name?: string | null
  leads_note?: string | null
  [key: string]: unknown
}

interface Delta {
  field: string
  before: unknown
  after: unknown
  reason: string
}

const PROPOSED_CANONICALS = new Set(['Partnership', 'Official Website', 'Facebook Lead Ads'])

function reconcileRecord(record: PriorRecord): Delta[] {
  const deltas: Delta[] = []

  // --- Invariants that moved to NULL in Phase 2C ---
  if (record.leads_urgency !== null && record.leads_urgency !== undefined) {
    deltas.push({
      field: 'leads_urgency',
      before: record.leads_urgency,
      after: null,
      reason:
        'Phase 2C: no Qonex field maps to CXLite urgency; prior "Medium" default removed.',
    })
  }
  if (record.leads_qualification_level && record.leads_qualification_level !== null) {
    deltas.push({
      field: 'leads_qualification_level',
      before: record.leads_qualification_level,
      after: null,
      reason:
        'Phase 2C: no Qonex field maps to CXLite qualification level; prior "Medium" placeholder removed.',
    })
  }
  if (record.leads_assigned_by && record.leads_assigned_by !== null) {
    deltas.push({
      field: 'leads_assigned_by',
      before: record.leads_assigned_by,
      after: null,
      reason: 'Phase 2C: migration-marker policy pending Ecovia; NULL in current mapping.',
    })
  }
  if (record.sales_manager_name && record.sales_manager_name !== null) {
    deltas.push({
      field: 'sales_manager_name',
      before: record.sales_manager_name,
      after: null,
      reason: 'Phase 2C: mirror of leads_assigned_by, both NULL pending Ecovia.',
    })
  }
  if (record.leads_company && record.leads_company !== null) {
    deltas.push({
      field: 'leads_company',
      before: record.leads_company,
      after: null,
      reason: 'Phase 2C: company mapping pending Ecovia confirmation.',
    })
  }
  if (record.leads_project && record.leads_project !== null) {
    deltas.push({
      field: 'leads_project',
      before: record.leads_project,
      after: null,
      reason: 'Phase 2C: project mapping pending Ecovia confirmation.',
    })
  }

  // --- Source: approved canonicals that LOOK like silent auto-apply
  //    cannot be inverted without the raw Qonex value. We flag them with
  //    "ambiguous" so the operator can re-check against the source Excel.
  if (
    typeof record.leads_source === 'string' &&
    PROPOSED_CANONICALS.has(record.leads_source)
  ) {
    deltas.push({
      field: 'leads_source',
      before: record.leads_source,
      after: '<raw Qonex source_data (unchanged from Excel)>',
      reason:
        'Phase 2C: pending-approval canonicals (Partnership / Official Website / Facebook Lead Ads) are no longer silently written. If this row originally had a pending Qonex source (Rumah123 / SML Website / Website Ecovia / Official - FB IG Ads Form), the output would revert to that raw string. Verify against the Qonex source_data column.',
    })
    if (typeof record.leads_channel === 'string') {
      deltas.push({
        field: 'leads_channel',
        before: record.leads_channel,
        after: '<UPPER(raw Qonex source_data)>',
        reason:
          'leads_channel = UPPER(leads_source); will revert alongside leads_source.',
      })
    }
  }

  // --- Shared status pipeline sanity: if leads_status is a legacy
  //     raw-upper (e.g. "SEND BROCHURE"), warn that it was already
  //     fixed. New runs produce the canonical UPPER instead.
  if (
    typeof record.leads_status === 'string' &&
    record.leads_group_status === 'UNKNOWN'
  ) {
    const resolved = resolveQonexStatus(record.leads_status)
    deltas.push({
      field: 'leads_status + leads_group_status',
      before: `${record.leads_status} / UNKNOWN`,
      after: `${resolved.upper ?? '<null>'} / ${resolved.group}`,
      reason:
        'Phase 2B status split bug: raw-upper leaked into leads_status while group was UNKNOWN. The shared pipeline now derives both from one call.',
    })
  }

  return deltas
}

function main(): number {
  const argPrior = process.argv.indexOf('--prior')
  const priorPath =
    argPrior >= 0 && process.argv[argPrior + 1]
      ? path.resolve(process.argv[argPrior + 1])
      : path.resolve(process.cwd(), 'sql-leads-dry-run.json')

  if (!fs.existsSync(priorPath)) {
    console.log(`[reconcile] no prior file at ${priorPath}`)
    console.log(
      '[reconcile] usage: npm run reconcile:dry-run -- --prior <path to sql-leads-dry-run.json>',
    )
    return 0
  }

  console.log(`[reconcile] prior: ${priorPath}`)
  let raw: string
  try {
    raw = fs.readFileSync(priorPath, 'utf-8')
  } catch (err) {
    console.error(
      `[reconcile] failed to read ${priorPath}: ${err instanceof Error ? err.message : err}`,
    )
    return 1
  }

  let records: PriorRecord[]
  try {
    const parsed = JSON.parse(raw)
    records = Array.isArray(parsed) ? parsed : (parsed.records ?? [parsed])
  } catch (err) {
    console.error(
      `[reconcile] invalid JSON: ${err instanceof Error ? err.message : err}`,
    )
    return 1
  }

  console.log(`[reconcile] inspected ${records.length} record(s)`)
  let changed = 0
  let unchanged = 0
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    const deltas = reconcileRecord(record)
    const identifier =
      record.id ??
      (record as { leads_id?: string }).leads_id ??
      `row-${i + 1}`
    if (deltas.length === 0) {
      unchanged++
      continue
    }
    changed++
    console.log('-'.repeat(72))
    console.log(`record ${identifier}`)
    for (const d of deltas) {
      console.log(`  • ${d.field}`)
      console.log(`      before: ${format(d.before)}`)
      console.log(`      after : ${format(d.after)}`)
      console.log(`      why   : ${d.reason}`)
    }
    // Also surface non-canonical pending sources in metadata.
    if (typeof record.leads_source === 'string') {
      const r = resolveQonexSource(record.leads_source)
      if (r.pending && r.proposedCanonical) {
        console.log(
          `  (metadata) pending-source-mapping: raw="${r.rawOriginal}" proposed="${r.proposedCanonical}" — proposal NOT silently applied in Phase 2C.`,
        )
      }
    }
  }
  console.log('='.repeat(72))
  console.log(
    `[reconcile] ${changed} record(s) would change · ${unchanged} record(s) unchanged`,
  )
  console.log('[reconcile] NO database rows were read, modified, or compared.')
  return 0
}

function format(value: unknown): string {
  if (value === null) return 'NULL'
  if (value === undefined) return '<undefined>'
  if (typeof value === 'string') return `"${value}"`
  return JSON.stringify(value)
}

try {
  process.exit(main())
} catch (err) {
  console.error(err instanceof Error ? err.stack : err)
  process.exit(1)
}
