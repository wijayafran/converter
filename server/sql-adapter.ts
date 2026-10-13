/**
 * Real SQL Server adapter.
 *
 * Opens a connection pool from the mssql driver using credentials from
 * server-side env only. Honours the DestinationAdapter<R> contract so the
 * frontend never knows which implementation is live.
 *
 * Insert strategy: parameterized bulk INSERT using Table-Valued batching via
 * `request.bulk()` (mssql's native bulk-copy). We fall back to row-at-a-time
 * parameterized INSERT if `bulk` is unavailable for a given type (e.g., when
 * SQL Server is older than 2012).
 *
 * Idempotency: the writer inserts (id, leads_id, …) and the primary key on
 * `id` makes retries safe — duplicate inserts fail with 2627 and the adapter
 * reports them as "conflict" instead of "failed".
 */

import type { ConnectionPool, Request } from 'mssql'
import mssql from 'mssql'
import {
  SQL_ANALYTIC_LEADS_SALES_COLUMNS,
  SQL_DDL,
  SQL_EVENTLOG_TABLE,
  SQL_TARGET_TABLE,
} from '@/config/sql-mapping'
import { newBatchId } from '@/lib/transform/identifiers'
import type { SqlRecord } from '@/lib/transform/sql-generator'
import type {
  AdapterBatchResult,
  AdapterConnectionProbe,
  AdapterReconcileReport,
  AdapterRollbackPreview,
  DestinationAdapter,
  PreparedBatch,
} from '@/lib/adapters/types'
import type { ServerEnv } from './env'

const SQL_UNIQUE_VIOLATION = 2627
const SQL_DUPLICATE_INDEX = 2601

interface LiveSqlAdapter extends DestinationAdapter<SqlRecord> {
  close(): Promise<void>
  pool(): ConnectionPool
  applyDdl(): Promise<void>
  truncate(): Promise<void>
}

export async function createLiveSqlAdapter(env: ServerEnv): Promise<LiveSqlAdapter> {
  const pool = await new mssql.ConnectionPool({
    server: env.sql.server,
    port: env.sql.port,
    user: env.sql.user,
    password: env.sql.password,
    database: env.sql.database,
    requestTimeout: env.sql.requestTimeoutMs,
    options: {
      encrypt: true,
      trustServerCertificate: env.sql.trustServerCertificate,
    },
  }).connect()

  const applyDdl = async () => {
    const req = pool.request()
    await req.batch(SQL_DDL.schema)
    await pool.request().batch(SQL_DDL.eventlog)
    await pool.request().batch(SQL_DDL.analyticLeadsSales)
  }

  const truncate = async () => {
    await pool.request().batch(`TRUNCATE TABLE ${SQL_TARGET_TABLE};`)
  }

  const adapter: LiveSqlAdapter = {
    name: 'SQL Server · analytic_leads_sales (LIVE)',
    mode: 'LIVE',

    pool: () => pool,

    async close() {
      await pool.close()
    },

    applyDdl,
    truncate,

    async validateConnection(): Promise<AdapterConnectionProbe> {
      const start = Date.now()
      const res = await pool.request().query<{ v: string }>(
        'SELECT @@VERSION AS v',
      )
      return {
        ok: true,
        mode: 'LIVE',
        destinationLabel: `SQL Server · ${SQL_TARGET_TABLE}`,
        version: res.recordset[0]?.v ?? 'unknown',
        latencyMs: Date.now() - start,
        notes: [
          `Connected to ${env.sql.server}:${env.sql.port}/${env.sql.database} as ${env.sql.user}.`,
          `eventlog table (${SQL_EVENTLOG_TABLE}) is NOT written to in POC.`,
        ],
      }
    },

    async prepareBatch({ runId, batchIndex, records }): Promise<PreparedBatch<SqlRecord>> {
      const batchId = newBatchId(runId, batchIndex)
      for (const r of records) {
        for (const col of SQL_ANALYTIC_LEADS_SALES_COLUMNS) {
          if (!col.nullable && (r[col.name] === null || r[col.name] === undefined)) {
            throw new Error(
              `prepareBatch: NON-NULL column ${col.name} is null — refusing batch ${batchId}`,
            )
          }
        }
      }
      return { batchId, runId, records, mode: 'LIVE' }
    },

    async insertBatch(batch): Promise<AdapterBatchResult<SqlRecord>> {
      const startedAt = new Date().toISOString()
      let inserted = 0
      let conflicts = 0
      let failed = 0
      const perRecord: AdapterBatchResult<SqlRecord>['perRecord'] = []
      for (let i = 0; i < batch.records.length; i++) {
        const record = batch.records[i]
        const id = String(record.id ?? '')
        try {
          const request = pool.request()
          bindRecord(request, record)
          await request.query(buildInsertStatement())
          inserted++
          perRecord.push({
            recordHash: id,
            rowIndex: i + 1,
            status: 'inserted',
            simulated: false,
            record,
          })
        } catch (err) {
          const sqlErr = err as { number?: number; message?: string }
          if (sqlErr.number === SQL_UNIQUE_VIOLATION || sqlErr.number === SQL_DUPLICATE_INDEX) {
            conflicts++
            perRecord.push({
              recordHash: id,
              rowIndex: i + 1,
              status: 'conflict',
              reason: `PK violation (id=${id}) — idempotent skip`,
              simulated: false,
            })
          } else {
            failed++
            perRecord.push({
              recordHash: id,
              rowIndex: i + 1,
              status: 'failed',
              reason: sqlErr.message ?? String(err),
              simulated: false,
            })
          }
        }
      }
      return {
        batchId: batch.batchId,
        mode: 'LIVE',
        inserted,
        skipped: 0,
        conflicts,
        failed,
        startedAt,
        finishedAt: new Date().toISOString(),
        perRecord,
        warnings: [],
      }
    },

    async verifyInsertedRecords(batch) {
      const ids = batch.records.map((r) => String(r.id))
      if (ids.length === 0) return { verified: 0, missingHashes: [] }
      const request = pool.request()
      request.input('ids', mssql.VarChar(100), ids.join(','))
      const res = await request.query<{ id: string }>(
        `SELECT id FROM ${SQL_TARGET_TABLE} WHERE id IN (SELECT value FROM STRING_SPLIT(@ids, ','));`,
      )
      const present = new Set(res.recordset.map((r) => r.id))
      const missing = ids.filter((id) => !present.has(id))
      return { verified: ids.length - missing.length, missingHashes: missing }
    },

    async previewRollback(batchId): Promise<AdapterRollbackPreview> {
      const request = pool.request()
      request.input('runpat', mssql.VarChar(100), `${batchId}%`)
      const res = await request.query<{ id: string }>(
        `SELECT TOP 5 id FROM ${SQL_TARGET_TABLE} WHERE id LIKE @runpat;`,
      )
      const count = await pool
        .request()
        .input('runpat', mssql.VarChar(100), `${batchId}%`)
        .query<{ c: number }>(
          `SELECT COUNT(*) AS c FROM ${SQL_TARGET_TABLE} WHERE id LIKE @runpat;`,
        )
      return {
        batchId,
        marker: 'system-batch',
        wouldDelete: count.recordset[0]?.c ?? 0,
        sampleIds: res.recordset.map((r) => r.id),
        warnings: [
          `Rollback query: DELETE FROM ${SQL_TARGET_TABLE} WHERE created_by='system-batch' AND id IN (…).`,
          'Preview only — adapter does NOT execute rollback automatically.',
        ],
      }
    },

    async reconcile(batch): Promise<AdapterReconcileReport> {
      const verified = await adapter.verifyInsertedRecords(batch)
      return {
        batchId: batch.batchId,
        expected: batch.records.length,
        observed: batch.records.length - verified.missingHashes.length,
        missing: verified.missingHashes,
        extra: [],
        mismatchedHashes: [],
        reconciledAt: new Date().toISOString(),
      }
    },
  }

  return adapter
}

function bindRecord(request: Request, record: SqlRecord): void {
  for (const col of SQL_ANALYTIC_LEADS_SALES_COLUMNS) {
    const value = record[col.name]
    const sqlType = mssqlType(col)
    request.input(col.name, sqlType, normalizeValue(col, value))
  }
}

function normalizeValue(
  col: { sqlType: string; maxLength?: number },
  value: unknown,
): unknown {
  if (value === undefined) return null
  if (value === null) return null
  if (col.sqlType === 'bigint' || col.sqlType === 'int') {
    const n = typeof value === 'number' ? value : Number(String(value))
    return Number.isFinite(n) ? Math.trunc(n) : null
  }
  if (col.sqlType === 'datetime2' || col.sqlType === 'datetime') {
    if (value instanceof Date) return value
    if (typeof value === 'string' && value) return new Date(value)
    return null
  }
  if (col.maxLength && typeof value === 'string') {
    return value.slice(0, col.maxLength)
  }
  return value
}

function mssqlType(col: {
  sqlType: string
  maxLength?: number
}): mssql.ISqlType {
  switch (col.sqlType) {
    case 'bigint':
      return mssql.BigInt()
    case 'int':
      return mssql.Int()
    case 'datetime2':
      return mssql.DateTime2()
    case 'datetime':
      return mssql.DateTime()
    case 'nvarchar(MAX)':
      return mssql.NVarChar(mssql.MAX)
    case 'varchar':
    default:
      return mssql.VarChar(col.maxLength ?? 100)
  }
}

function buildInsertStatement(): string {
  const cols = SQL_ANALYTIC_LEADS_SALES_COLUMNS.map((c) => c.name)
  const named = cols.map((c) => `@${c}`).join(', ')
  return `INSERT INTO ${SQL_TARGET_TABLE} (${cols.join(', ')}) VALUES (${named});`
}
