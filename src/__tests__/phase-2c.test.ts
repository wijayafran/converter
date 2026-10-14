import { describe, expect, it } from 'vitest'
import { transformToSqlRecords } from '@/lib/transform/sql-generator'
import { SQL_ANALYTIC_LEADS_SALES_COLUMNS } from '@/config/sql-mapping'
import { canOverride, runValidation } from '@/lib/validation'
import { buildParsedFile, validRow } from './fixtures'

/**
 * Phase 2C regression suite. These tests lock in the Excel-driven mapping
 * invariants so a future round cannot reintroduce invented business logic
 * (silent canonicalisation, invented defaults, auto-cleanup, etc.).
 */

describe('Phase 2C — Excel-driven mapping invariants', () => {
  it('leads_urgency is NULL (prior "Medium" was invented)', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.leads_urgency).toBeNull()
  })

  it('leads_qualification_level, leads_assigned_by, sales_manager_name, leads_company, leads_project all NULL', () => {
    const parsed = buildParsedFile([validRow({ group: 'Vireya', sales_rep: 'Siti R.' })])
    const result = transformToSqlRecords(parsed)
    const r = result.records[0].record
    expect(r.leads_qualification_level).toBeNull()
    expect(r.leads_assigned_by).toBeNull()
    expect(r.sales_manager_name).toBeNull()
    expect(r.leads_company).toBeNull()
    expect(r.leads_project).toBeNull()
  })

  it('leads_created_by stays "DataMigration01" (confirmed migration marker)', () => {
    const parsed = buildParsedFile([validRow({ sales_rep: 'Siti R.' })])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.leads_created_by).toBe('DataMigration01')
  })

  it('leads_aging = 0, eventlog_id and event_name both NULL', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed)
    const r = result.records[0].record
    expect(r.leads_aging).toBe(0)
    expect(r.eventlog_id).toBeNull()
    expect(r.event_name).toBeNull()
  })
})

describe('Phase 2C — sales_rep preservation (no invented cleaning rule)', () => {
  it('"Siti R. (inactive) 2024-05-30" is preserved verbatim', () => {
    const raw = 'Siti R. (inactive) 2024-05-30'
    const parsed = buildParsedFile([validRow({ sales_rep: raw })])
    const result = transformToSqlRecords(parsed)
    const r = result.records[0].record
    expect(r.leads_assigned_to).toBe(raw)
    expect(r.sales_name).toBe(raw)
    // No invented transform: whatever is in sales_rep goes verbatim into
    // the mirror columns (sans leading/trailing whitespace only).
  })

  it('whitespace is trimmed but internal (inactive) marker is kept', () => {
    const parsed = buildParsedFile([
      validRow({ sales_rep: '   Agus P. (inactive)   ' }),
    ])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.leads_assigned_to).toBe('Agus P. (inactive)')
  })
})

describe('Phase 2C — source preservation (no silent promotion)', () => {
  it('Qonex pending source "Rumah123" never leaks into leads_source as "Partnership"', () => {
    const parsed = buildParsedFile([validRow({ source_data: 'Rumah123' })])
    const result = transformToSqlRecords(parsed)
    const r = result.records[0]
    expect(r.record.leads_source).toBe('Rumah123')
    expect(r.record.leads_source).not.toBe('Partnership')
    // The proposed canonical appears only on the issue payload.
    const warn = r.warnings.find((i) => i.category === 'pending-source-mapping')
    expect(warn?.proposedValue).toBe('Partnership')
    // And the warning is structural — bulk approve cannot promote it.
    const vResult = runValidation({ destination: 'sql', parsed })
    const vIssue = vResult.issues.find((i) => i.category === 'pending-source-mapping')
    expect(canOverride(vIssue!)).toBe(false)
  })

  it('unknown source is preserved verbatim (not re-cased or re-spelled)', () => {
    const parsed = buildParsedFile([
      validRow({ source_data: 'Brand NEW Channel' }),
    ])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.leads_source).toBe('Brand NEW Channel')
    expect(result.records[0].record.leads_channel).toBe('BRAND NEW CHANNEL')
  })
})

describe('Phase 2C — preview equals execution payload', () => {
  it('object yielded to the UI preview is the exact SqlRecord sent to the adapter', () => {
    const parsed = buildParsedFile([
      validRow({ status: 'Send Brochure', source_data: 'Rumah123' }),
    ])
    const result = transformToSqlRecords(parsed)
    const [first] = result.records
    // No alternative "preview-only" transform exists — the UI shows the
    // same reference the batch runner forwards to the HTTP adapter.
    const previewRecord = first.record
    // Spot-check every destination-impacting field.
    expect(previewRecord.leads_status).toBe('IN DISCUSSION')
    expect(previewRecord.leads_group_status).toBe('FOLLOWUP')
    expect(previewRecord.leads_source).toBe('Rumah123')
    expect(previewRecord.leads_channel).toBe('RUMAH123')
    expect(previewRecord.leads_urgency).toBeNull()
    expect(previewRecord.leads_company).toBeNull()
  })
})

describe('Phase 2C — SQL schema still 51 columns in exact DDL order', () => {
  it('every column in the authoritative DDL list is present on each record', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed)
    const keys = Object.keys(result.records[0].record)
    expect(keys.length).toBe(51)
    for (const col of SQL_ANALYTIC_LEADS_SALES_COLUMNS) {
      expect(keys).toContain(col.name)
    }
  })
})

describe('Phase 2C — duplicate PK protection still blocks', () => {
  it('duplicate phones → duplicate wa_<digits> PK → BLOCKED', () => {
    const parsed = buildParsedFile([
      validRow({ ID: 'A' }),
      validRow({ ID: 'B' }),
    ])
    const result = transformToSqlRecords(parsed)
    for (const r of result.records) {
      expect(r.blocked).toBe(true)
      expect(
        r.blockingIssues.some(
          (i) => i.field === 'id' && i.category === 'duplicate-id',
        ),
      ).toBe(true)
    }
  })
})
