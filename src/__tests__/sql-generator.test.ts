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

describe('transformToSqlRecords', () => {
  it('emits all 51 columns per row', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed, { dryRun: true })
    expect(result.records).toHaveLength(1)
    const columns = Object.keys(result.records[0].record)
    expect(columns.length).toBe(51)
    for (const c of SQL_ANALYTIC_LEADS_SALES_COLUMNS) {
      expect(columns).toContain(c.name)
    }
  })

  it('generates stable leads_id for identical legacy IDs', () => {
    const a = transformToSqlRecords(buildParsedFile([validRow()]))
    const b = transformToSqlRecords(buildParsedFile([validRow()]))
    expect(a.records[0].record.leads_id).toBe(b.records[0].record.leads_id)
  })

  it('populates wa_mobile with the configured prefix', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed, {
      waMobilePrefix: 'wa_',
      dryRun: true,
    })
    expect(result.records[0].record.leads_wa_mobile).toBe('wa_6281234567890')
  })

  it('writes leads_aging=0 and migration marker on every row', () => {
    const parsed = buildParsedFile([validRow(), validRow({ ID: 'QX-00002' })])
    const result = transformToSqlRecords(parsed, { dryRun: true })
    for (const r of result.records) {
      expect(r.record.leads_aging).toBe(0)
      expect(r.record.leads_migration_marker).toBe('MIGRATION_V1')
      expect(r.record.leads_source_system).toBe('QONEX')
      expect(r.record.leads_migration_dry_run).toBe(true)
    }
  })

  it('blocks when required fields are missing', () => {
    const parsed = buildParsedFile([validRow({ nama_prospek: '', nomor_telepon: '' })])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].blocked).toBe(true)
    const categories = result.records[0].blockingIssues.map((i) => i.category)
    expect(categories).toContain('missing-required')
  })

  it('detects duplicate legacy IDs as BLOCKED', () => {
    const parsed = buildParsedFile([
      validRow({ ID: 'QX-DUP' }),
      validRow({ ID: 'QX-DUP', nomor_telepon: '0812-9999-0000' }),
    ])
    const result = transformToSqlRecords(parsed)
    for (const r of result.records) {
      expect(r.blocked).toBe(true)
      expect(r.blockingIssues.some((i) => i.category === 'duplicate-id')).toBe(true)
    }
  })

  it('flags duplicate phone as WARNING, not BLOCKED', () => {
    const parsed = buildParsedFile([
      validRow({ ID: 'A' }),
      validRow({ ID: 'B' }),
    ])
    const result = transformToSqlRecords(parsed)
    expect(result.records[0].blocked).toBe(false)
    expect(
      result.records[0].warnings.some((i) => i.category === 'duplicate-phone'),
    ).toBe(true)
  })

  it('truncates NVARCHAR values that exceed max length and warns', () => {
    const parsed = buildParsedFile([
      validRow({ keterangan: 'x'.repeat(5000) }),
    ])
    const result = transformToSqlRecords(parsed)
    expect((result.records[0].record.leads_notes as string).length).toBeLessThanOrEqual(4000)
    expect(
      result.records[0].warnings.some(
        (i) => i.category === 'destination-constraint' && i.field === 'leads_notes',
      ),
    ).toBe(true)
  })

  it('converts timestamps to UTC + Jakarta pair', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed)
    const r = result.records[0].record
    expect(r.leads_created_at).toBe('2026-02-01T02:14:00.000Z')
    expect(String(r.leads_created_at_wib)).toContain('+07:00')
  })

  it('scales to 8000 rows under 5s', () => {
    const parsed = buildLargeDataset(8000)
    const t0 = Date.now()
    const result = transformToSqlRecords(parsed, { dryRun: true })
    const elapsed = Date.now() - t0
    expect(result.records.length).toBe(8000)
    expect(elapsed).toBeLessThan(5000)
  })

  it('buildSqlPreviewStatement produces a parameterized hint + inlined sample', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed, { dryRun: true })
    const stmt = buildSqlPreviewStatement(
      result.records.map((r) => r.record),
      1,
    )
    expect(stmt).toContain('parameterized')
    expect(stmt).toContain('INSERT INTO')
    expect(stmt).toContain('@p1')
  })
})
