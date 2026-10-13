/**
 * HTTP-backed SQL adapter.
 *
 * Implements DestinationAdapter<SqlRecord> by calling the local backend at
 * MIGRATION_SERVER_BASE_URL (default http://127.0.0.1:4318). The browser
 * never sees SA credentials; the backend reads them from its own env.
 *
 * The adapter also calls `/api/sql/apply-ddl` once per instance before the
 * first batch so a fresh container is bootstrapped automatically. If the
 * target table already exists the backend's IF OBJECT_ID guard makes it a
 * no-op.
 *
 * Important: this adapter is marked `mode: 'LIVE'`. The MOCK adapter stays
 * available for unit tests and the UI's Dry Run default.
 */

import type { SqlRecord } from '@/lib/transform/sql-generator'
import type {
  AdapterBatchResult,
  AdapterConnectionProbe,
  AdapterReconcileReport,
  AdapterRollbackPreview,
  DestinationAdapter,
  PreparedBatch,
} from './types'
import { newBatchId } from '@/lib/transform/identifiers'

export interface HttpSqlAdapterOptions {
  baseUrl?: string
  autoApplyDdl?: boolean
  fetchFn?: typeof fetch
}

export function createHttpSqlAdapter(
  options: HttpSqlAdapterOptions = {},
): DestinationAdapter<SqlRecord> {
  // Empty baseUrl → use relative paths so the Vite dev proxy or any reverse
  // proxy in production handles the host:port. Explicit value overrides.
  const rawBase = options.baseUrl ?? ''
  const baseUrl = rawBase.replace(/\/+$/, '')
  const autoApplyDdl = options.autoApplyDdl ?? true
  const fetchFn = options.fetchFn ?? fetch
  let ddlApplied = false

  async function post<T>(path: string, body: unknown = {}): Promise<T> {
    const resp = await fetchFn(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await resp.text()
    let parsed: unknown = text
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      /* keep text */
    }
    if (!resp.ok) {
      const message =
        typeof parsed === 'object' && parsed && 'error' in parsed
          ? String((parsed as { error: string }).error)
          : `HTTP ${resp.status}: ${text}`
      throw new Error(message)
    }
    return parsed as T
  }

  async function ensureDdl(): Promise<void> {
    if (!autoApplyDdl || ddlApplied) return
    await post<{ ok: boolean }>('/api/sql/apply-ddl')
    ddlApplied = true
  }

  return {
    name: 'SQL Server · HTTP backend (LIVE)',
    mode: 'LIVE',

    async validateConnection(): Promise<AdapterConnectionProbe> {
      return post<AdapterConnectionProbe>('/api/sql/validate-connection')
    },

    async prepareBatch({ runId, batchIndex, records }): Promise<PreparedBatch<SqlRecord>> {
      await ensureDdl()
      const batchId = newBatchId(runId, batchIndex)
      return { batchId, runId, records, mode: 'LIVE' }
    },

    async insertBatch(batch): Promise<AdapterBatchResult<SqlRecord>> {
      const result = await post<AdapterBatchResult<SqlRecord>>(
        '/api/sql/execute-batch',
        {
          runId: batch.runId,
          batchIndex: Number(batch.batchId.split('-B').pop() ?? '1') - 1,
          records: batch.records,
        },
      )
      return result
    },

    async verifyInsertedRecords(batch) {
      const report = await post<AdapterReconcileReport>('/api/sql/reconcile', {
        runId: batch.runId,
        batchIndex: Number(batch.batchId.split('-B').pop() ?? '1') - 1,
        records: batch.records,
      })
      return { verified: report.observed, missingHashes: report.missing }
    },

    async previewRollback(batchId): Promise<AdapterRollbackPreview> {
      return post<AdapterRollbackPreview>('/api/sql/rollback-preview', { batchId })
    },

    async reconcile(batch): Promise<AdapterReconcileReport> {
      return post<AdapterReconcileReport>('/api/sql/reconcile', {
        runId: batch.runId,
        batchIndex: Number(batch.batchId.split('-B').pop() ?? '1') - 1,
        records: batch.records,
      })
    },
  }
}
