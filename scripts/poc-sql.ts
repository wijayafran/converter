/**
 * SQL Server POC acceptance:
 *   1. apply authoritative DDL  (dev_analytic_cxlite.{eventlog, analytic_leads_sales})
 *   2. truncate the target table to a known state
 *   3. transform one synthetic Qonex row and INSERT it
 *   4. SELECT the inserted row by id and compare field-by-field
 *   5. attempt to INSERT the same id again and expect a PK conflict (2627)
 *   6. assert the eventlog table is still empty (POC never writes to it)
 *
 * MUST run against a real SQL Server (set MIGRATION_LIVE=true).
 * MUST NOT run against production — the script hard-fails if the host or
 * database name matches a production allowlist.
 */

import { assertLiveReady, readEnv } from '../server/env'
import { createLiveSqlAdapter } from '../server/sql-adapter'
import { transformToSqlRecords } from '@/lib/transform/sql-generator'
import { SQL_EVENTLOG_TABLE, SQL_TARGET_TABLE } from '@/config/sql-mapping'
import { buildParsedFile, validRow } from '../src/__tests__/fixtures'

const PRODUCTION_SIGNALS = [
  'prod', 'production', 'cxlite.prod', 'analytic.prod', 'sinarmas', 'azure.net',
]

function refuseProduction(host: string, db: string) {
  const probe = `${host} ${db}`.toLowerCase()
  for (const sig of PRODUCTION_SIGNALS) {
    if (probe.includes(sig)) {
      throw new Error(
        `REFUSE: host="${host}" db="${db}" matches a production signal "${sig}". Run against a local-only POC.`,
      )
    }
  }
}

async function main() {
  const env = readEnv()
  if (!env.liveEnabled) {
    console.error('✗ MIGRATION_LIVE=true is required for the POC. Aborting.')
    process.exit(2)
  }
  const problems = assertLiveReady(env)
  if (problems.length > 0) {
    for (const p of problems) console.error('✗', p)
    process.exit(2)
  }
  refuseProduction(env.sql.server, env.sql.database)

  console.log(`[poc:sql] target=${env.sql.server}:${env.sql.port}/${env.sql.database}`)
  const adapter = await createLiveSqlAdapter(env)
  try {
    const probe = await adapter.validateConnection()
    console.log(`[poc:sql] ✓ connected: ${probe.version?.split('\n')[0]}`)

    console.log(`[poc:sql] applying DDL (${SQL_TARGET_TABLE} + ${SQL_EVENTLOG_TABLE})…`)
    await adapter.applyDdl()
    console.log('[poc:sql] ✓ DDL applied / already present')

    await adapter.truncate()
    console.log('[poc:sql] ✓ truncated target table')

    const parsed = buildParsedFile([validRow({ ID: 'POC-SQL-0001' })])
    const result = transformToSqlRecords(parsed)
    const record = result.records[0].record
    const prepared = await adapter.prepareBatch({
      runId: 'POC-SQL',
      batchIndex: 0,
      records: [record],
    })
    const insert = await adapter.insertBatch(prepared)
    if (insert.inserted !== 1) {
      throw new Error(`inserted=${insert.inserted}, expected 1 (${JSON.stringify(insert.perRecord)})`)
    }
    console.log('[poc:sql] ✓ synthetic row inserted')

    const req = adapter.pool().request()
    req.input('id', record.id)
    const readBack = await req.query<Record<string, unknown>>(
      `SELECT * FROM ${SQL_TARGET_TABLE} WHERE id = @id`,
    )
    if (readBack.recordset.length !== 1) {
      throw new Error('read-back returned 0 rows')
    }
    const row = readBack.recordset[0]
    const criticalFields = [
      'id', 'event_name', 'leads_parent_channel', 'leads_channel',
      'leads_customer_name', 'leads_customer_phone', 'leads_status',
      'leads_group_status', 'leads_aging', 'leads_total_score', 'leads_property_price',
    ]
    for (const f of criticalFields) {
      const expected = record[f] as unknown
      const got = row[f] as unknown
      const same =
        expected === got ||
        (expected === null && (got === null || got === undefined)) ||
        String(expected) === String(got)
      if (!same) {
        throw new Error(`field "${f}" differs — expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`)
      }
    }
    console.log(`[poc:sql] ✓ read-back matches on ${criticalFields.length} fields`)

    const dupPrep = await adapter.prepareBatch({
      runId: 'POC-SQL',
      batchIndex: 1,
      records: [record],
    })
    const dup = await adapter.insertBatch(dupPrep)
    if (dup.conflicts !== 1) {
      throw new Error(`duplicate-key test expected conflicts=1, got ${JSON.stringify(dup)}`)
    }
    console.log('[poc:sql] ✓ duplicate key correctly reported as conflict')

    const eventlog = await adapter.pool().request().query<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${SQL_EVENTLOG_TABLE}`,
    )
    const count = eventlog.recordset[0]?.c ?? -1
    if (count !== 0) {
      throw new Error(`eventlog expected to be empty (POC does not write to it) but has ${count} rows`)
    }
    console.log('[poc:sql] ✓ eventlog is untouched (0 rows)')

    console.log('[poc:sql] ALL CHECKS PASSED (LIVE)')
  } finally {
    await adapter.close()
  }
}

main().catch((err) => {
  console.error('[poc:sql] FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
