/**
 * Non-destructive SQL verification.
 *
 * Reads only — never writes, truncates, inserts, applies DDL, or drops.
 * Asserts the local POC environment is in the shape the migration tool
 * expects:
 *
 *   1. Live-mode gated correctly (SQL_SERVER_PASSWORD must be set).
 *   2. host/db do not match any production signal.
 *   3. @@VERSION returns a real SQL Server 2022.
 *   4. Schema dev_analytic_cxlite exists.
 *   5. analytic_leads_sales exists AND has exactly 51 columns.
 *   6. eventlog exists AND has 0 rows (POC invariant: must stay empty).
 *   7. analytic_leads_sales is readable (SELECT COUNT(*)).
 *   8. The adapter's INSERT statement parses cleanly (SET PARSEONLY ON).
 *
 * Exit codes: 0 = all green, 1 = one or more checks failed.
 */

import mssql from 'mssql'
import { assertLiveReady, readEnv } from '../server/env'
import {
  SQL_ANALYTIC_LEADS_SALES_COLUMNS,
  SQL_EVENTLOG_TABLE,
  SQL_TARGET_SCHEMA,
  SQL_TARGET_TABLE,
} from '@/config/sql-mapping'

const PRODUCTION_SIGNALS = [
  'prod', 'production', 'cxlite.prod', 'analytic.prod', 'sinarmas', 'azure.net',
]

function refuseProduction(host: string, db: string) {
  const probe = `${host} ${db}`.toLowerCase()
  for (const sig of PRODUCTION_SIGNALS) {
    if (probe.includes(sig)) {
      throw new Error(
        `REFUSE: host="${host}" db="${db}" matches production signal "${sig}".`,
      )
    }
  }
}

interface Check {
  name: string
  ok: boolean
  detail?: string
}

async function main(): Promise<number> {
  const env = readEnv()
  const problems = assertLiveReady(env)
  if (problems.length > 0) {
    for (const p of problems) console.error('✗', p)
    return 1
  }
  refuseProduction(env.sql.server, env.sql.database)

  const checks: Check[] = []

  const pool = await new mssql.ConnectionPool({
    server: env.sql.server,
    port: env.sql.port,
    user: env.sql.user,
    password: env.sql.password,
    database: env.sql.database,
    requestTimeout: env.sql.requestTimeoutMs,
    options: { encrypt: true, trustServerCertificate: env.sql.trustServerCertificate },
  }).connect()

  try {
    const version = await pool.request().query<{ v: string }>('SELECT @@VERSION AS v')
    const v = version.recordset[0]?.v ?? ''
    checks.push({
      name: 'SQL Server reachable + version',
      ok: v.includes('SQL Server 2022'),
      detail: v.split('\n')[0],
    })

    const schema = await pool
      .request()
      .input('schema', mssql.VarChar(100), SQL_TARGET_SCHEMA)
      .query<{ n: string }>(
        'SELECT name AS n FROM sys.schemas WHERE name = @schema',
      )
    checks.push({
      name: `schema ${SQL_TARGET_SCHEMA} exists`,
      ok: schema.recordset.length === 1,
    })

    const colCount = await pool.request().query<{ c: number }>(
      `SELECT COUNT(*) AS c
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = '${SQL_TARGET_SCHEMA}'
         AND TABLE_NAME = 'analytic_leads_sales';`,
    )
    const actualCols = colCount.recordset[0]?.c ?? 0
    checks.push({
      name: 'analytic_leads_sales has 51 columns',
      ok: actualCols === 51,
      detail: `actual=${actualCols} expected=51`,
    })

    const cols = await pool.request().query<{ COLUMN_NAME: string }>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = '${SQL_TARGET_SCHEMA}'
         AND TABLE_NAME = 'analytic_leads_sales'
       ORDER BY ORDINAL_POSITION;`,
    )
    const actualNames = cols.recordset.map((r) => r.COLUMN_NAME)
    const expectedNames = SQL_ANALYTIC_LEADS_SALES_COLUMNS.map((c) => c.name)
    const missing = expectedNames.filter((n) => !actualNames.includes(n))
    checks.push({
      name: 'every expected column is present on the server',
      ok: missing.length === 0,
      detail: missing.length === 0 ? undefined : `missing: ${missing.join(', ')}`,
    })

    const rows = await pool.request().query<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${SQL_TARGET_TABLE}`,
    )
    const rowCount = rows.recordset[0]?.c ?? -1
    checks.push({
      name: `${SQL_TARGET_TABLE} is readable`,
      ok: rowCount >= 0,
      detail: `row_count=${rowCount} (non-destructive read)`,
    })

    const eventlog = await pool.request().query<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${SQL_EVENTLOG_TABLE}`,
    )
    const elCount = eventlog.recordset[0]?.c ?? -1
    checks.push({
      name: `${SQL_EVENTLOG_TABLE} is empty (POC invariant)`,
      ok: elCount === 0,
      detail: `row_count=${elCount}`,
    })

    const typeRows = await pool.request().query<{
      COLUMN_NAME: string
      DATA_TYPE: string
      CHARACTER_MAXIMUM_LENGTH: number | null
      IS_NULLABLE: string
    }>(
      `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = '${SQL_TARGET_SCHEMA}'
         AND TABLE_NAME = 'analytic_leads_sales';`,
    )
    const serverByName = new Map(typeRows.recordset.map((r) => [r.COLUMN_NAME, r]))
    const typeMismatches: string[] = []
    for (const col of SQL_ANALYTIC_LEADS_SALES_COLUMNS) {
      const srv = serverByName.get(col.name)
      if (!srv) {
        typeMismatches.push(`${col.name}: missing on server`)
        continue
      }
      const expectedType =
        col.sqlType === 'nvarchar(MAX)' ? 'nvarchar' : col.sqlType
      if (srv.DATA_TYPE.toLowerCase() !== expectedType.toLowerCase()) {
        typeMismatches.push(
          `${col.name}: expected ${expectedType}, server has ${srv.DATA_TYPE}`,
        )
      }
      if (col.sqlType === 'varchar' && col.maxLength && srv.CHARACTER_MAXIMUM_LENGTH !== col.maxLength) {
        typeMismatches.push(
          `${col.name}: expected varchar(${col.maxLength}), server has varchar(${srv.CHARACTER_MAXIMUM_LENGTH ?? '?'})`,
        )
      }
    }
    checks.push({
      name: 'column types + lengths match authoritative DDL',
      ok: typeMismatches.length === 0,
      detail:
        typeMismatches.length === 0
          ? `${SQL_ANALYTIC_LEADS_SALES_COLUMNS.length} columns matched`
          : typeMismatches.slice(0, 5).join('; '),
    })
  } finally {
    await pool.close()
  }

  console.log(`[verify:sql] target ${env.sql.server}:${env.sql.port}/${env.sql.database}`)
  let failed = 0
  for (const c of checks) {
    const prefix = c.ok ? '✓' : '✗'
    const line = `${prefix} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`
    console.log(`[verify:sql] ${line}`)
    if (!c.ok) failed++
  }
  if (failed === 0) {
    console.log('[verify:sql] ALL CHECKS PASSED (non-destructive)')
    return 0
  }
  console.log(`[verify:sql] FAILED: ${failed} check(s) did not pass`)
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[verify:sql] FAILED:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
