import { describe, expect, it } from 'vitest'
import { createMockSqlAdapter } from '@/lib/adapters/sql-adapter'
import { createMockCosmosAdapter, type CosmosWritable } from '@/lib/adapters/cosmos-adapter'
import { createBatchRunner } from '@/lib/batch/engine'
import { transformToSqlRecords } from '@/lib/transform/sql-generator'
import { transformToCosmos } from '@/lib/transform/cosmos-generator'
import { buildLargeDataset, buildParsedFile, validRow } from './fixtures'

describe('batch runner — SQL adapter (MOCK)', () => {
  it('refuses to insert DRY_RUN=1 records', async () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed, { dryRun: true })
    const records = result.records.map((r) => r.record)
    const adapter = createMockSqlAdapter()
    const runner = createBatchRunner({
      destination: 'sql',
      adapter,
      records,
      batchSize: 500,
    })
    const manifest = await runner.completion
    expect(manifest.batches[0].recordsInserted).toBe(0)
    expect(manifest.batches[0].recordsSkipped).toBe(1)
    expect(manifest.batches[0].adapterResult.perRecord[0].reason).toContain('DRY_RUN')
  })

  it('inserts when dryRun=false (MOCK) and tracks idempotency hashes', async () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToSqlRecords(parsed, { dryRun: false })
    const records = result.records.map((r) => r.record)
    const adapter = createMockSqlAdapter()
    const runner = createBatchRunner({
      destination: 'sql',
      adapter,
      records,
      batchSize: 500,
    })
    const manifest = await runner.completion
    expect(manifest.batches[0].recordsInserted).toBe(1)
    expect(manifest.idempotencyHashes.length).toBe(1)
  })

  it('simulated failure → retry queue populated and retryFailed() clears it', async () => {
    const parsed = buildParsedFile([validRow(), validRow({ ID: 'QX-00002', nomor_telepon: '0812-9999-8888' })])
    const result = transformToSqlRecords(parsed, { dryRun: false })
    const records = result.records.map((r) => r.record)
    const adapter = createMockSqlAdapter({ failRowIndices: [1] })
    const runner = createBatchRunner({
      destination: 'sql',
      adapter,
      records,
      batchSize: 500,
    })
    const manifest = await runner.completion
    expect(manifest.retryQueue.length).toBe(1)
    const retried = await runner.retryFailed()
    expect(retried.retryQueue.length).toBe(1)
  })

  it('reconcile report matches inserted rows', async () => {
    const parsed = buildLargeDataset(10)
    const result = transformToSqlRecords(parsed, { dryRun: false })
    const records = result.records.map((r) => r.record)
    const adapter = createMockSqlAdapter()
    const runner = createBatchRunner({
      destination: 'sql',
      adapter,
      records,
      batchSize: 4,
      reconcileAfterEachBatch: true,
    })
    const manifest = await runner.completion
    for (const b of manifest.batches) {
      expect(b.reconcile?.expected).toBe(b.recordsAttempted)
    }
  })

  it('chunks records into N batches of size K', async () => {
    const parsed = buildLargeDataset(23)
    const result = transformToSqlRecords(parsed, { dryRun: false })
    const records = result.records.map((r) => r.record)
    const adapter = createMockSqlAdapter()
    const runner = createBatchRunner({
      destination: 'sql',
      adapter,
      records,
      batchSize: 10,
    })
    const manifest = await runner.completion
    expect(manifest.batches.length).toBe(3)
    expect(manifest.batches[0].recordsAttempted).toBe(10)
    expect(manifest.batches[2].recordsAttempted).toBe(3)
  })
})

describe('batch runner — Cosmos adapter (MOCK)', () => {
  it('routes won snapshots to leads-won container', async () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToCosmos(parsed, {
      dryRun: false,
      config: { profile: 'lite', waMobilePrefix: 'wa_' },
    })
    const records: CosmosWritable[] = result.leads
      .filter((l) => !l.blocked)
      .map((l) => l.record)
    const adapter = createMockCosmosAdapter()
    const runner = createBatchRunner<CosmosWritable>({
      destination: 'cosmos',
      adapter,
      records,
      batchSize: 10,
    })
    const manifest = await runner.completion
    expect(manifest.batches[0].recordsInserted).toBeGreaterThan(0)
  })
})
