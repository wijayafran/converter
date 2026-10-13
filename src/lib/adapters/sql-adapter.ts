/**
 * SQL Server adapter — MOCK implementation.
 *
 * This adapter never opens a real SQL connection. It fully implements the
 * `DestinationAdapter` contract so the batch engine and UI can be exercised
 * end-to-end against a predictable sandbox. Every result is marked
 * `simulated: true` and the adapter's mode is `MOCK`.
 *
 * The future production adapter will share this exact signature; swapping
 * implementations is a single-line change in the batch runner.
 */

import { newBatchId } from '@/lib/transform/identifiers'
import {
  buildSqlInsertStatement,
  type SqlRecord,
} from '@/lib/transform/sql-generator'
import { SQL_ANALYTIC_LEADS_SALES_COLUMNS, SQL_TARGET_TABLE } from '@/config/sql-mapping'
import type {
  AdapterBatchResult,
  AdapterConnectionProbe,
  AdapterReconcileReport,
  AdapterRollbackPreview,
  DestinationAdapter,
  PreparedBatch,
} from './types'

export interface MockSqlAdapterOptions {
  failRowIndices?: number[]
  conflictHashes?: string[]
  latencyMs?: number
}

const MIGRATION_MARKER = 'MIGRATION_V1'

export function createMockSqlAdapter(
  options: MockSqlAdapterOptions = {},
): DestinationAdapter<SqlRecord> {
  const latency = options.latencyMs ?? 15
  const insertedHashes = new Map<string, SqlRecord>()
  const batches = new Map<string, PreparedBatch<SqlRecord>>()

  return {
    name: 'MOCK SQL · analytic_leads_sales',
    mode: 'MOCK',

    async validateConnection(): Promise<AdapterConnectionProbe> {
      await delay(latency)
      return {
        ok: true,
        mode: 'MOCK',
        destinationLabel: `SQL Server · ${SQL_TARGET_TABLE}`,
        version: 'MOCK-ADAPTER-0.1',
        latencyMs: latency,
        notes: [
          'MOCK adapter — no network traffic occurs.',
          'Replace with a real SQL adapter in Phase 2 (same interface).',
        ],
      }
    },

    async prepareBatch({ runId, batchIndex, records }): Promise<PreparedBatch<SqlRecord>> {
      await delay(latency)
      const batchId = newBatchId(runId, batchIndex)
      const stamped: SqlRecord[] = records.map((r) => ({
        ...r,
        leads_migration_batch_id: batchId,
      }))
      for (const col of SQL_ANALYTIC_LEADS_SALES_COLUMNS) {
        for (const r of stamped) {
          const value = r[col.name]
          if (!col.nullable && (value === null || value === undefined)) {
            throw new Error(
              `prepareBatch: NON-NULL column ${col.name} is null — refusing batch ${batchId}`,
            )
          }
        }
      }
      const prepared: PreparedBatch<SqlRecord> = {
        batchId,
        runId,
        records: stamped,
        mode: 'MOCK',
      }
      batches.set(batchId, prepared)
      return prepared
    },

    async insertBatch(batch): Promise<AdapterBatchResult<SqlRecord>> {
      await delay(latency)
      const startedAt = new Date().toISOString()
      let inserted = 0
      let skipped = 0
      let conflicts = 0
      let failed = 0
      const perRecord: AdapterBatchResult<SqlRecord>['perRecord'] = []
      for (const record of batch.records) {
        const hash = String(record.leads_hash ?? '')
        const row = Number(record.leads_migration_source_row ?? 0)
        if (options.failRowIndices?.includes(row)) {
          failed++
          perRecord.push({
            recordHash: hash,
            rowIndex: row,
            status: 'failed',
            reason: 'MOCK-FAIL (adapter configured to fail this row)',
            simulated: true,
          })
          continue
        }
        if (options.conflictHashes?.includes(hash) || insertedHashes.has(hash)) {
          conflicts++
          perRecord.push({
            recordHash: hash,
            rowIndex: row,
            status: 'conflict',
            reason: 'Hash already inserted — idempotent skip',
            simulated: true,
          })
          continue
        }
        if (record.leads_migration_dry_run === true) {
          skipped++
          perRecord.push({
            recordHash: hash,
            rowIndex: row,
            status: 'skipped',
            reason: 'DRY_RUN=1 — adapter refuses to insert',
            simulated: true,
          })
          continue
        }
        insertedHashes.set(hash, record)
        inserted++
        perRecord.push({
          recordHash: hash,
          rowIndex: row,
          status: 'inserted',
          simulated: true,
          record,
        })
      }
      return {
        batchId: batch.batchId,
        mode: 'MOCK',
        inserted,
        skipped,
        conflicts,
        failed,
        startedAt,
        finishedAt: new Date().toISOString(),
        perRecord,
        warnings: ['MOCK adapter — numbers are simulated.'],
      }
    },

    async verifyInsertedRecords(batch) {
      await delay(latency)
      const missing: string[] = []
      let verified = 0
      for (const r of batch.records) {
        const hash = String(r.leads_hash ?? '')
        if (insertedHashes.has(hash)) verified++
        else missing.push(hash)
      }
      return { verified, missingHashes: missing }
    },

    async previewRollback(batchId): Promise<AdapterRollbackPreview> {
      await delay(latency)
      const batch = batches.get(batchId)
      if (!batch) {
        return {
          batchId,
          marker: MIGRATION_MARKER,
          wouldDelete: 0,
          sampleIds: [],
          warnings: [`Unknown batch ${batchId} — nothing to roll back.`],
        }
      }
      const matching = batch.records
        .map((r) => String(r.leads_id))
        .filter((id) => insertedHashes.has(String(batch.records.find((x) => x.leads_id === id)?.leads_hash)))
      return {
        batchId,
        marker: MIGRATION_MARKER,
        wouldDelete: matching.length,
        sampleIds: matching.slice(0, 5),
        warnings: [
          `Rollback is scoped to leads_migration_batch_id='${batchId}' AND leads_migration_marker='${MIGRATION_MARKER}'.`,
          'MOCK adapter — the preview reflects simulated inserts, not real rows.',
        ],
      }
    },

    async reconcile(batch): Promise<AdapterReconcileReport> {
      await delay(latency)
      const expected = batch.records.length
      const missing: string[] = []
      const mismatched: string[] = []
      let observed = 0
      for (const r of batch.records) {
        const hash = String(r.leads_hash ?? '')
        const stored = insertedHashes.get(hash)
        if (!stored) {
          missing.push(hash)
          continue
        }
        observed++
        if (stored.leads_customer_phone !== r.leads_customer_phone) {
          mismatched.push(hash)
        }
      }
      return {
        batchId: batch.batchId,
        expected,
        observed,
        missing,
        extra: [],
        mismatchedHashes: mismatched,
        reconciledAt: new Date().toISOString(),
      }
    },
  }
}

export function describeInsertStatement(): string {
  const columns = SQL_ANALYTIC_LEADS_SALES_COLUMNS.map((c) => c.name)
  return buildSqlInsertStatement(columns)
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
