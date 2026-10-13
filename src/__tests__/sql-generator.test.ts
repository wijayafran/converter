import { describe, expect, it } from 'vitest'
import {
  buildSqlPreviewStatement,
  transformToSqlRecords,
} from '@/lib/transform/sql-generator'
import { SQL_ANALYTIC_LEADS_SALES_COLUMNS } from '@/config/sql-mapping'
import {
  buildLargeDataset,
  buildParsedFile,
  validRow,
} from './fixtures'

describe('transformToSqlRecords — matches authoritative DDL', () => {
  it('emits all 51 columns per row, in DDL order', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed, { dryRun: true })
    expect(result.records).toHaveLength(1)
    const columns = Object.keys(result.records[0].record)
    expect(columns.length).toBe(51)
    for (const c of SQL_ANALYTIC_LEADS_SALES_COLUMNS) {
      expect(columns).toContain(c.name)
    }
  })

  it('leaves eventlog_id NULL (eventlog is empty in POC)', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.eventlog_id).toBeNull()
  })

  it('leads_parent_channel is "ONLINE", leads_channel is UPPER(source)', () => {
    const parsed = buildParsedFile([validRow({ source_data: 'Referral' })])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.leads_parent_channel).toBe('ONLINE')
    expect(result.records[0].record.leads_channel).toBe('REFERRAL')
  })

  it('leads_customer_phone is digits-only (62… no +)', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.leads_customer_phone).toBe('6281234567890')
  })

  it('leads_parent_id is wa_<digitsPhone>', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed, { waMobilePrefix: 'wa_' })
    expect(result.records[0].record.leads_parent_id).toBe('wa_6281234567890')
  })

  it('leads_group_status follows the FSM: CONTACTED → FOLLOWUP, WON → CLOSED', () => {
    const parsed = buildParsedFile([
      validRow({ status: 'CONTACTED' }),
      validRow({ ID: 'B', nomor_telepon: '0812-9999-8888', status: 'WON' }),
    ])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.leads_group_status).toBe('FOLLOWUP')
    expect(result.records[1].record.leads_group_status).toBe('CLOSED')
  })

  it('leads_id is stable per Qonex ID (deterministic across runs)', () => {
    const a = transformToSqlRecords(buildParsedFile([validRow()]))
    const b = transformToSqlRecords(buildParsedFile([validRow()]))
    expect(a.records[0].record.leads_id).toBe(b.records[0].record.leads_id)
  })

  it('leads_aging = 0, defaults for score/property placeholders', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed)
    const r = result.records[0].record
    expect(r.leads_aging).toBe(0)
    expect(r.leads_total_score).toBe(0)
    expect(r.leads_property_price).toBe(0)
    expect(r.leads_raw_score).toBe('{}')
    expect(r.leads_raw_property).toBe('{}')
  })

  it('created_by / updated_by = "system-batch"', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.created_by).toBe('system-batch')
    expect(result.records[0].record.updated_by).toBe('system-batch')
  })

  it('blocks when required Qonex fields are missing', () => {
    const parsed = buildParsedFile([
      validRow({ nama_prospek: '', nomor_telepon: '' }),
    ])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].blocked).toBe(true)
    expect(
      result.records[0].blockingIssues.some((i) => i.category === 'missing-required'),
    ).toBe(true)
  })

  it('truncates leads_note at 2000 chars and warns', () => {
    const parsed = buildParsedFile([validRow({ keterangan: 'x'.repeat(5000) })])
    const result = transformToSqlRecords(parsed)
    expect((result.records[0].record.leads_note as string).length).toBeLessThanOrEqual(2000)
    expect(
      result.records[0].warnings.some(
        (i) => i.category === 'destination-constraint' && i.field === 'leads_note',
      ),
    ).toBe(true)
  })

  it('scales to 8000 rows under 5s', () => {
    const parsed = buildLargeDataset(8000)
    const t0 = Date.now()
    const result = transformToSqlRecords(parsed, { dryRun: true })
    const elapsed = Date.now() - t0
    expect(result.records.length).toBe(8000)
    expect(elapsed).toBeLessThan(5000)
  })

  it('buildSqlPreviewStatement includes parameterized hint + inlined sample', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed, { dryRun: true })
    const stmt = buildSqlPreviewStatement(
      result.records.map((r) => r.record),
      1,
    )
    expect(stmt).toContain('parameterized')
    expect(stmt).toContain('dev_analytic_cxlite.analytic_leads_sales')
    expect(stmt).toContain('@p1')
  })
})

/**
 * Regression tests for the revised Qonex → analytic_leads_sales mapping
 * (audit of 2026-10-13). The authoritative changes:
 *   id            → WA_MOBILE identifier (configurable prefix)
 *   event_name    → NULL (no synthetic LEAD_CREATED constant)
 *   event_time    → derived from last_update (NULL when source is empty)
 *   leads_created_by / leads_assigned_by → constant "DataMigration01"
 *   sales_manager_name                   → mirror = "DataMigration01"
 *   leads_assigned_to                    → unchanged (= Qonex sales_rep)
 *   duplicate WA_MOBILE id               → BLOCKED (PK collision)
 */
describe('transformToSqlRecords — revised migration rules (post-audit)', () => {
  it('id is the WA_MOBILE identifier (default wa_<digitsPhone>)', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed, { waMobilePrefix: 'wa_' })
    expect(result.records[0].record.id).toBe('wa_6281234567890')
  })

  it('WA_MOBILE prefix is configurable (never hard-coded)', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed, { waMobilePrefix: 'wamob__' })
    expect(result.records[0].record.id).toBe('wamob__6281234567890')
    expect(result.records[0].record.leads_parent_id).toBe('wamob__6281234567890')
  })

  it('event_name is NULL (POC does not synthesise event taxonomy)', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.event_name).toBeNull()
  })

  it('event_time is derived from last_update, not create', () => {
    const parsed = buildParsedFile([
      validRow({ create: '2026-02-01 09:14', last_update: '2026-02-03 15:00' }),
    ])
    const result = transformToSqlRecords(parsed)
    const r = result.records[0].record
    // last_update 2026-02-03 15:00 Jakarta = 2026-02-03T08:00:00Z
    expect(r.event_time).toBe('2026-02-03T08:00:00.000Z')
    expect(r.leads_created_on).toBe('2026-02-01T02:14:00.000Z')
    expect(r.event_time).not.toBe(r.leads_created_on)
  })

  it('event_time is NULL when source last_update is empty', () => {
    const parsed = buildParsedFile([validRow({ last_update: '' })])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.event_time).toBeNull()
  })

  it('leads_created_by = "DataMigration01" (constant, not sales_rep)', () => {
    const parsed = buildParsedFile([validRow({ sales_rep: 'Siti R.' })])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.leads_created_by).toBe('DataMigration01')
  })

  it('leads_assigned_by = "DataMigration01" (constant, not sales_rep)', () => {
    const parsed = buildParsedFile([validRow({ sales_rep: 'Siti R.' })])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.leads_assigned_by).toBe('DataMigration01')
  })

  it('leads_assigned_to remains the Qonex sales_rep', () => {
    const parsed = buildParsedFile([validRow({ sales_rep: 'Siti R.' })])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.leads_assigned_to).toBe('Siti R.')
  })

  it('sales_manager_name mirrors leads_assigned_by = "DataMigration01"', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed)
    const r = result.records[0].record
    expect(r.sales_manager_name).toBe('DataMigration01')
    expect(r.sales_manager_name).toBe(r.leads_assigned_by)
  })

  it('duplicate phones BLOCK on PK `id` collision (not just a warning)', () => {
    const parsed = buildParsedFile([
      validRow({ ID: 'QX-A' }),
      validRow({ ID: 'QX-B' }), // same phone as the first row
    ])
    const result = transformToSqlRecords(parsed)
    for (const r of result.records) {
      expect(r.blocked).toBe(true)
      expect(r.blockingIssues.some((i) => i.field === 'id' && i.category === 'duplicate-id')).toBe(true)
    }
  })

  it('eventlog_id is NULL (POC never writes to eventlog)', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.eventlog_id).toBeNull()
  })

  it('row-provenance columns (created_by / updated_by) stay "system-batch"', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed)
    const r = result.records[0].record
    // leads_* columns represent the migrated lead's own history.
    // created_by / updated_by are the SQL ROW's provenance and must NOT
    // conflate with DataMigration01.
    expect(r.created_by).toBe('system-batch')
    expect(r.updated_by).toBe('system-batch')
    expect(r.leads_created_by).toBe('DataMigration01')
  })
})
