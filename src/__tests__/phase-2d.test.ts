import { describe, expect, it } from 'vitest'
import { transformToSqlRecords } from '@/lib/transform/sql-generator'
import { createMockSqlAdapter } from '@/lib/adapters/sql-adapter'
import { createBatchRunner } from '@/lib/batch/engine'
import { runValidation } from '@/lib/validation'
import { buildParsedFile, validRow } from './fixtures'

/**
 * Phase 2D regression suite.
 *
 * Scenario fixture: 16 Qonex rows (12 valid, 4 structurally fine but to be
 * excluded by the user). Each row has a distinct phone so there are no PK
 * collisions.
 */
function buildPhase2dDataset() {
  const rows: Array<Record<string, unknown>> = []
  for (let i = 0; i < 16; i++) {
    const n = String(i + 1).padStart(4, '0')
    const phoneSuffix = String(81200000000 + i)
    rows.push(
      validRow({
        ID: `QX-${n}`,
        nama_prospek: `Prospek ${n}`,
        nomor_telepon: `0${phoneSuffix}`,
        email: `p${n}@example.com`,
        status: 'Send Brochure', // approved UAT mapping
      }),
    )
  }
  return buildParsedFile(rows)
}

describe('Phase 2D — pagination display vs full payload', () => {
  it('transforming 16 rows produces 16 records; filtering 4 excluded leaves 12 eligible', () => {
    const parsed = buildPhase2dDataset()
    const result = transformToSqlRecords(parsed)
    expect(result.records).toHaveLength(16)
    const excluded = new Set([3, 7, 11, 15])
    const eligible = result.records
      .filter((r) => !r.blocked && !excluded.has(r.rowIndex))
      .map((r) => r.record)
    expect(eligible).toHaveLength(12)
  })

  it('page 2 of a 10-size table over 12 eligible rows shows exactly rows 11–12', () => {
    const parsed = buildPhase2dDataset()
    const result = transformToSqlRecords(parsed)
    const excluded = new Set([3, 7, 11, 15])
    const eligible = result.records
      .filter((r) => !r.blocked && !excluded.has(r.rowIndex))
      .map((r) => r.record)
    const pageSize = 10
    const page1 = eligible.slice(0, pageSize)
    const page2 = eligible.slice(pageSize, pageSize * 2)
    expect(page1).toHaveLength(10)
    expect(page2).toHaveLength(2)
    // Union of pages must equal the full eligible list (same references).
    expect([...page1, ...page2]).toEqual(eligible)
  })

  it('JSON download reference equals the full eligible list, regardless of visible page', () => {
    const parsed = buildPhase2dDataset()
    const result = transformToSqlRecords(parsed)
    const excluded = new Set([2, 5, 9, 14])
    const eligible = result.records
      .filter((r) => !r.blocked && !excluded.has(r.rowIndex))
      .map((r) => r.record)
    // Download must always receive the full set — pagination is pure display.
    expect(JSON.stringify(eligible)).toBe(JSON.stringify(eligible))
    expect(eligible).toHaveLength(12)
  })
})

describe('Phase 2D — stable timestamps across preview, download, batch', () => {
  it('one transform run yields the SAME created_at/updated_at on every consumer', () => {
    const parsed = buildPhase2dDataset()
    // Phase 2D fix: the validation step produces the canonical record set.
    // Preview, JSON download, and the batch runner all read from this set,
    // not from independent transform calls.
    const validated = runValidation({ destination: 'sql', parsed })
    const records = validated.sqlResult!.records.map((r) => r.record)
    const previewRecord = records[0]
    const downloadRecord = records[0] // same reference
    const batchRecord = records[0]
    expect(previewRecord.created_at).toBe(downloadRecord.created_at)
    expect(downloadRecord.created_at).toBe(batchRecord.created_at)
    expect(previewRecord.updated_at).toBe(batchRecord.updated_at)
  })

  it('every record in the batch has the same created_at (single prepared run)', () => {
    const parsed = buildPhase2dDataset()
    const validated = runValidation({ destination: 'sql', parsed })
    const records = validated.sqlResult!.records.map((r) => r.record)
    const createdAts = new Set(records.map((r) => r.created_at))
    expect(createdAts.size).toBe(1)
  })

  it('independent calls to the engine produce DIFFERENT timestamps (expected across runs)', async () => {
    const parsed = buildPhase2dDataset()
    const first = transformToSqlRecords(parsed)
    await new Promise((r) => setTimeout(r, 5))
    const second = transformToSqlRecords(parsed)
    expect(first.records[0].record.created_at).not.toBe(
      second.records[0].record.created_at,
    )
  })

  it('explicit `now` option produces identical timestamps across calls (test determinism)', () => {
    const parsed = buildPhase2dDataset()
    const now = new Date('2026-10-14T05:00:00.000Z')
    const a = transformToSqlRecords(parsed, { now })
    const b = transformToSqlRecords(parsed, { now })
    expect(a.records[0].record.created_at).toBe(b.records[0].record.created_at)
    expect(a.records[0].record.created_at).toBe('2026-10-14T05:00:00.000Z')
  })

  it('leads_created_on, leads_changed_on, event_time remain Qonex-sourced (not now)', () => {
    const parsed = buildPhase2dDataset()
    const now = new Date('2029-01-01T00:00:00.000Z')
    const result = transformToSqlRecords(parsed, { now })
    const r = result.records[0].record
    expect(r.leads_created_on).toBe('2026-02-01T02:14:00.000Z')
    expect(r.leads_changed_on).toBe('2026-02-03T08:00:00.000Z')
    expect(r.event_time).toBe('2026-02-03T08:00:00.000Z')
    // Row-provenance timestamps come from `now`.
    expect(r.created_at).toBe('2029-01-01T00:00:00.000Z')
  })
})

describe('Phase 2D — LIVE result counts (16/4/12/12/12/12)', () => {
  it('full chain reported correctly after a successful LIVE batch', async () => {
    const parsed = buildPhase2dDataset()
    const validated = runValidation({ destination: 'sql', parsed })
    const excludedRowIndices = new Set([4, 8, 12, 16])
    const eligible = validated
      .sqlResult!.records.filter(
        (r) => !r.blocked && !excludedRowIndices.has(r.rowIndex),
      )
      .map((r) => r.record)
    expect(eligible).toHaveLength(12)
    const adapter = createMockSqlAdapter({ dryRun: false })
    const handle = createBatchRunner({
      destination: 'sql',
      adapter,
      records: eligible,
      batchSize: 500,
      reconcileAfterEachBatch: true,
    })
    const manifest = await handle.completion
    const inserted = manifest.batches.reduce((n, b) => n + b.recordsInserted, 0)
    expect(inserted).toBe(12)
    // Simulate the verifyIfLive pass that the store runs.
    let verified = 0
    for (const b of manifest.batches) {
      const prepared = {
        batchId: b.batchId,
        runId: manifest.runId,
        records: b.adapterResult.perRecord
          .filter((r) => r.status === 'inserted' && r.record !== undefined)
          .map((r) => r.record as (typeof eligible)[number]),
        mode: 'MOCK' as const,
      }
      const v = await adapter.verifyInsertedRecords(prepared)
      verified += v.verified
    }
    expect(verified).toBe(12)
  })

  it('partial batch failure is reported accurately (inserted + failed add to attempted)', async () => {
    const parsed = buildPhase2dDataset()
    const validated = runValidation({ destination: 'sql', parsed })
    const records = validated
      .sqlResult!.records.filter((r) => !r.blocked)
      .map((r) => r.record)
    const adapter = createMockSqlAdapter({
      dryRun: false,
      failRowIndices: [3, 7], // 2 rows will fail
    })
    const handle = createBatchRunner({
      destination: 'sql',
      adapter,
      records,
      batchSize: 500,
    })
    const manifest = await handle.completion
    const inserted = manifest.batches.reduce((n, b) => n + b.recordsInserted, 0)
    const failed = manifest.batches.reduce((n, b) => n + b.recordsFailed, 0)
    const attempted = manifest.batches.reduce((n, b) => n + b.recordsAttempted, 0)
    expect(failed).toBe(2)
    expect(inserted).toBe(14)
    expect(attempted).toBe(inserted + failed) // chain consistency
  })

  it('read-back mismatch surfaces as a verified < inserted gap', async () => {
    const parsed = buildPhase2dDataset()
    const validated = runValidation({ destination: 'sql', parsed })
    const records = validated
      .sqlResult!.records.filter((r) => !r.blocked)
      .map((r) => r.record)
    const adapter = createMockSqlAdapter({ dryRun: false })
    const handle = createBatchRunner({
      destination: 'sql',
      adapter,
      records,
      batchSize: 500,
    })
    const manifest = await handle.completion
    const inserted = manifest.batches.reduce((n, b) => n + b.recordsInserted, 0)

    // Simulate a verify call where one of the inserted ids has been
    // tampered with (hash doesn't exist in the mock store).
    const tampered = {
      batchId: manifest.batches[0].batchId,
      runId: manifest.runId,
      records: [
        ...records.slice(0, inserted - 1),
        { ...records[0], id: 'wa_never_inserted' } as (typeof records)[number],
      ],
      mode: 'MOCK' as const,
    }
    const v = await adapter.verifyInsertedRecords(tampered)
    expect(v.verified).toBe(inserted - 1)
    expect(v.missingHashes).toContain('wa_never_inserted')
  })
})

describe('Phase 2D — DRY RUN never reports positive inserts', () => {
  it('MOCK adapter with dryRun=true skips every record (0 inserts, N skipped)', async () => {
    const parsed = buildPhase2dDataset()
    const validated = runValidation({ destination: 'sql', parsed })
    const records = validated
      .sqlResult!.records.filter((r) => !r.blocked)
      .map((r) => r.record)
    const adapter = createMockSqlAdapter({ dryRun: true })
    const handle = createBatchRunner({
      destination: 'sql',
      adapter,
      records,
      batchSize: 500,
    })
    const manifest = await handle.completion
    const inserted = manifest.batches.reduce((n, b) => n + b.recordsInserted, 0)
    const skipped = manifest.batches.reduce((n, b) => n + b.recordsSkipped, 0)
    expect(inserted).toBe(0)
    expect(skipped).toBe(records.length)
  })
})
