/**
 * Local-stack diagnose: a single, non-destructive health walk that answers
 * every question in the "LIVE blocked" investigation checklist.
 *
 * Reads .env automatically (via `node --env-file-if-exists=.env`). Reports
 * each check with a clear OK / FAIL / INFO status and a concrete remedy
 * line. Exit code is non-zero only if a real blocker is found.
 *
 * The script never truncates, inserts, nor connects to Azure DEV / prod.
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import mssql from 'mssql'
import { assertLiveReady, readEnv } from '../server/env'
import {
  SQL_ANALYTIC_LEADS_SALES_COLUMNS,
  SQL_EVENTLOG_TABLE,
  SQL_TARGET_SCHEMA,
  SQL_TARGET_TABLE,
} from '@/config/sql-mapping'

const run = promisify(exec)

interface Check {
  id: string
  title: string
  status: 'OK' | 'FAIL' | 'INFO'
  detail: string
  remedy?: string
}

const checks: Check[] = []
function record(c: Check) {
  checks.push(c)
}

const PRODUCTION_SIGNALS = ['prod', 'production', 'cxlite.prod', 'analytic.prod', 'sinarmas', 'azure.net']
function refuseProduction(host: string, db: string) {
  const probe = `${host} ${db}`.toLowerCase()
  for (const sig of PRODUCTION_SIGNALS) {
    if (probe.includes(sig)) throw new Error(`REFUSE: "${probe}" matches "${sig}"`)
  }
}

async function tryBackendHealth(port: number) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/health`)
    const text = await resp.text()
    let body: any = text
    try { body = JSON.parse(text) } catch {}
    return { ok: resp.ok, status: resp.status, body }
  } catch (err) {
    return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) }
  }
}

async function dockerPs(name: string): Promise<string | null> {
  try {
    const { stdout } = await run(`docker ps -a --filter name=^/${name}$ --format '{{.Status}}'`)
    const out = stdout.trim()
    return out || null
  } catch {
    return null
  }
}

async function main(): Promise<number> {
  const env = readEnv()

  // 1. env + password presence
  assertLiveReady(env)
  record({
    id: 'env.live-flag',
    title: 'MIGRATION_LIVE flag',
    status: env.liveEnabled ? 'OK' : 'INFO',
    detail: env.liveEnabled ? 'LIVE opt-in is enabled' : 'DRY_RUN (default)',
    remedy: env.liveEnabled ? undefined : 'set MIGRATION_LIVE=true to enable real SQL writes',
  })
  record({
    id: 'env.sql-password',
    title: 'SQL_SERVER_PASSWORD',
    status: env.sql.password ? 'OK' : 'FAIL',
    detail: env.sql.password ? `set (${env.sql.password.length} chars)` : 'empty — LIVE SQL is blocked',
    remedy: env.sql.password ? undefined : 'start via `npm run server:live` (auto-loads .env), or export SQL_SERVER_PASSWORD before starting',
  })
  record({
    id: 'env.cosmos-key',
    title: 'COSMOS_KEY',
    status: env.cosmos.key ? 'OK' : 'INFO',
    detail: env.cosmos.key
      ? 'set (local emulator default key by default; Cosmos LIVE is intentionally deferred)'
      : 'empty',
  })

  // 2. SQL container status
  const sqlStatus = await dockerPs('lemons-mssql')
  record({
    id: 'docker.sql',
    title: 'Docker container lemons-mssql',
    status: sqlStatus?.startsWith('Up') ? 'OK' : 'FAIL',
    detail: sqlStatus ?? 'not found',
    remedy: sqlStatus?.startsWith('Up')
      ? undefined
      : 'docker start lemons-mssql (if removed, re-run the Phase 2B SQL setup)',
  })

  // Refuse production endpoints before any live attempt
  try {
    refuseProduction(env.sql.server, env.sql.database)
  } catch (err) {
    record({
      id: 'safety.production',
      title: 'Production refusal',
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
      remedy: 'point SQL_SERVER_HOST / SQL_SERVER_DATABASE at a local-only POC resource',
    })
    emit()
    return 1
  }

  // 3. Backend reachable + liveProblems
  const probe = await tryBackendHealth(env.port)
  if (!probe.ok) {
    record({
      id: 'backend.reachable',
      title: `Backend /api/health on :${env.port}`,
      status: 'FAIL',
      detail: `status=${probe.status} body=${JSON.stringify(probe.body).slice(0, 200)}`,
      remedy: 'start the backend: `npm run server:live`',
    })
    emit()
    return 1
  }
  const liveProblems: string[] = Array.isArray(probe.body?.liveProblems) ? probe.body.liveProblems : []
  record({
    id: 'backend.reachable',
    title: `Backend /api/health on :${env.port}`,
    status: 'OK',
    detail: `mode=${probe.body?.mode} liveProblems=${liveProblems.length}`,
  })
  record({
    id: 'backend.live-blockers',
    title: 'Backend LIVE blockers (via /api/health)',
    status: liveProblems.length === 0 ? 'OK' : 'FAIL',
    detail: liveProblems.length === 0 ? 'none' : liveProblems.join('; '),
    remedy: liveProblems.length === 0
      ? undefined
      : 'restart the backend with .env loaded (`npm run server:live` picks up .env automatically on Node 20.6+)',
  })

  // 4. /api/sql/validate-connection
  try {
    const resp = await fetch(`http://127.0.0.1:${env.port}/api/sql/validate-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const body = (await resp.json()) as {
      destinationLabel?: string
      latencyMs?: number
      error?: string
    }
    if (resp.ok) {
      record({
        id: 'backend.validate-connection',
        title: 'POST /api/sql/validate-connection',
        status: 'OK',
        detail: `${body.destinationLabel ?? 'ok'} · latency ${body.latencyMs ?? '?'}ms`,
      })
    } else {
      record({
        id: 'backend.validate-connection',
        title: 'POST /api/sql/validate-connection',
        status: 'FAIL',
        detail: `status=${resp.status} error=${body.error ?? ''}`,
        remedy: resp.status === 403
          ? 'the backend is running without SQL credentials; restart via `npm run server:live`'
          : 'investigate backend logs (/tmp/server.log if started by this harness)',
      })
    }
  } catch (err) {
    record({
      id: 'backend.validate-connection',
      title: 'POST /api/sql/validate-connection',
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
      remedy: 'confirm the backend is listening and reachable on 127.0.0.1',
    })
  }

  // 5. Direct SQL probe (bypassing the backend) — confirms the DB itself.
  if (env.sql.password) {
    const pool = new mssql.ConnectionPool({
      server: env.sql.server,
      port: env.sql.port,
      user: env.sql.user,
      password: env.sql.password,
      database: env.sql.database,
      options: { encrypt: true, trustServerCertificate: env.sql.trustServerCertificate },
      requestTimeout: 5000,
      connectionTimeout: 5000,
    })
    try {
      await pool.connect()
      const v = await pool.request().query<{ v: string }>('SELECT @@VERSION AS v')
      record({
        id: 'sql.direct',
        title: 'Direct SQL connect to cxlite_poc',
        status: 'OK',
        detail: (v.recordset[0]?.v ?? '').split('\n')[0],
      })
      const cols = await pool.request().query<{ c: number }>(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = '${SQL_TARGET_SCHEMA}' AND TABLE_NAME='analytic_leads_sales'`,
      )
      record({
        id: 'sql.schema',
        title: `${SQL_TARGET_TABLE} has ${SQL_ANALYTIC_LEADS_SALES_COLUMNS.length} columns`,
        status: (cols.recordset[0]?.c ?? 0) === 51 ? 'OK' : 'FAIL',
        detail: `actual=${cols.recordset[0]?.c ?? 0}`,
      })
      const evt = await pool.request().query<{ c: number }>(`SELECT COUNT(*) AS c FROM ${SQL_EVENTLOG_TABLE}`)
      record({
        id: 'sql.eventlog',
        title: `${SQL_EVENTLOG_TABLE} invariant (empty in POC)`,
        status: (evt.recordset[0]?.c ?? -1) === 0 ? 'OK' : 'FAIL',
        detail: `rows=${evt.recordset[0]?.c ?? '?'}`,
      })
    } catch (err) {
      record({
        id: 'sql.direct',
        title: 'Direct SQL connect to cxlite_poc',
        status: 'FAIL',
        detail: err instanceof Error ? err.message : String(err),
        remedy: 'check lemons-mssql is up and SA password in .env matches the container',
      })
    } finally {
      await pool.close().catch(() => {})
    }
  } else {
    record({
      id: 'sql.direct',
      title: 'Direct SQL connect to cxlite_poc',
      status: 'INFO',
      detail: 'skipped — SQL_SERVER_PASSWORD empty',
    })
  }

  // 6. Vite dev server + proxy wiring.
  // Vite binds to IPv6 ([::1]) by default — hit it via `localhost` so the
  // probe works regardless of the dual-stack resolution path.
  let viteStatus: number | null = null
  try {
    const resp = await fetch('http://localhost:5173/', { signal: AbortSignal.timeout(2000) })
    viteStatus = resp.status
  } catch {}
  record({
    id: 'vite.dev-server',
    title: 'Vite dev server on :5173',
    status: viteStatus ? 'OK' : 'INFO',
    detail: viteStatus ? `status=${viteStatus}` : 'not running',
    remedy: viteStatus ? undefined : 'start the UI with `npm run dev`',
  })
  if (viteStatus) {
    try {
      const resp = await fetch('http://localhost:5173/api/health', { signal: AbortSignal.timeout(2000) })
      const body = (await resp.json()) as { mode?: string }
      record({
        id: 'vite.api-proxy',
        title: 'Vite /api proxy → backend',
        status: resp.ok && typeof body.mode === 'string' ? 'OK' : 'FAIL',
        detail: `status=${resp.status} mode=${body.mode}`,
        remedy: resp.ok ? undefined : 'confirm vite.config.ts proxy block and backend availability',
      })
    } catch (err) {
      record({
        id: 'vite.api-proxy',
        title: 'Vite /api proxy → backend',
        status: 'FAIL',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 7. CORS (direct backend origin — belt and braces, in case the UI bypasses the proxy)
  try {
    const resp = await fetch(`http://127.0.0.1:${env.port}/api/health`, {
      headers: { Origin: 'http://127.0.0.1:5173' },
    })
    const allow = resp.headers.get('access-control-allow-origin') ?? ''
    record({
      id: 'cors.direct',
      title: 'CORS Access-Control-Allow-Origin',
      status: allow === '*' || allow.includes('5173') ? 'OK' : 'INFO',
      detail: `header="${allow}"`,
    })
  } catch (err) {
    record({
      id: 'cors.direct',
      title: 'CORS Access-Control-Allow-Origin',
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  emit()
  const failed = checks.filter((c) => c.status === 'FAIL').length
  return failed === 0 ? 0 : 1
}

function emit() {
  console.log('='.repeat(72))
  console.log('LEMONS local stack diagnose')
  console.log('='.repeat(72))
  for (const c of checks) {
    const marker = c.status === 'OK' ? '✓' : c.status === 'FAIL' ? '✗' : '·'
    console.log(`${marker} [${c.id}] ${c.title}`)
    console.log(`    ${c.detail}`)
    if (c.remedy) console.log(`    → ${c.remedy}`)
  }
  const okCount = checks.filter((c) => c.status === 'OK').length
  const failCount = checks.filter((c) => c.status === 'FAIL').length
  const infoCount = checks.filter((c) => c.status === 'INFO').length
  console.log('-'.repeat(72))
  console.log(`summary: ${okCount} ok · ${failCount} failed · ${infoCount} info`)
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[diagnose] FAILED:', err instanceof Error ? err.stack : err)
    process.exit(1)
  })
