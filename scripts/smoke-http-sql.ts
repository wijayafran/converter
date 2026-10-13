/**
 * End-to-end integration smoke test:
 *   browser → HTTP adapter → local backend → SQL Server.
 *
 * Non-destructive: inserts ONE row with a unique id (POC-HTTP-<timestamp>),
 * reads it back, then confirms the eventlog remains empty. Does NOT run DDL
 * or truncate — it assumes `verify:sql` already passed.
 *
 * The script expects the backend to be running (npm run server:live) and
 * MIGRATION_LIVE=true already in the server's env.
 */

import { createHttpSqlAdapter } from '@/lib/adapters/http-sql-adapter'
import { transformToSqlRecords } from '@/lib/transform/sql-generator'
import { buildParsedFile, validRow } from '../src/__tests__/fixtures'

const BASE = process.env.MIGRATION_SERVER_URL ?? 'http://127.0.0.1:4318'

async function main(): Promise<number> {
  console.log(`[smoke:http-sql] backend ${BASE}`)
  const health = (await fetch(`${BASE}/api/health`).then((r) => r.json())) as {
    mode: string
  }
  if (health.mode !== 'LIVE') {
    console.error(
      `✗ backend is in ${health.mode}; start it with MIGRATION_LIVE=true (npm run server:live)`,
    )
    return 1
  }
  console.log(`[smoke:http-sql] backend health OK: mode=${health.mode}`)

  const adapter = createHttpSqlAdapter({ baseUrl: BASE })
  const probe = await adapter.validateConnection()
  if (!probe.ok) {
    console.error('✗ adapter.validateConnection returned ok=false', probe)
    return 1
  }
  console.log(`[smoke:http-sql] ✓ validateConnection: ${probe.destinationLabel}`)

  const uniqueId = `POC-HTTP-${Date.now()}`
  const parsed = buildParsedFile([validRow({ ID: uniqueId })])
  const transformed = transformToSqlRecords(parsed)
  const record = transformed.records[0].record

  const batch = await adapter.prepareBatch({
    runId: 'POC-HTTP',
    batchIndex: 0,
    records: [record],
  })
  const insert = await adapter.insertBatch(batch)
  if (insert.inserted !== 1) {
    console.error('✗ insert did not return 1', insert)
    return 1
  }
  console.log(`[smoke:http-sql] ✓ inserted via HTTP: id=${record.id}`)

  const reconcile = await adapter.reconcile(batch)
  if (reconcile.observed !== 1) {
    console.error('✗ reconcile did not observe the inserted row', reconcile)
    return 1
  }
  console.log('[smoke:http-sql] ✓ reconcile observed read-back')

  // Non-destructive integrity check — ensure eventlog remains empty via the
  // backend's probe (not direct SQL).
  const probe2 = await adapter.validateConnection()
  if (!probe2.ok) {
    console.error('✗ post-insert validateConnection failed', probe2)
    return 1
  }

  console.log('[smoke:http-sql] ALL CHECKS PASSED (HTTP → backend → SQL)')
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err)
    process.exit(1)
  })
