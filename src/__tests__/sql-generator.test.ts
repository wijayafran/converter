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

  it('emits event_name = LEAD_CREATED (initial snapshot POC)', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].record.event_name).toBe('LEAD_CREATED')
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
