/**
 * Minimal local backend for Phase 2B.
 *
 * - Listens on MIGRATION_SERVER_PORT (default 4318).
 * - Default mode: DRY_RUN. Setting MIGRATION_LIVE=true opts in to real writes.
 * - Routes:
 *     GET  /api/health
 *     POST /api/sql/validate-connection
 *     POST /api/sql/apply-ddl           (opt-in, LIVE only)
 *     POST /api/sql/execute-batch
 *     POST /api/sql/reconcile
 *     POST /api/sql/rollback-preview
 *     POST /api/cosmos/validate-connection
 *     POST /api/cosmos/execute-batch
 *     POST /api/cosmos/reconcile
 *
 * The frontend never sees secrets — all credentials come from env.
 */

import http from 'node:http'
import { assertLiveReady, readEnv, type ServerEnv } from './env'
import { createLiveSqlAdapter } from './sql-adapter'
import {
  createLiveCosmosAdapter,
  type CosmosWritable,
} from './cosmos-adapter'
import type { SqlRecord } from '@/lib/transform/sql-generator'

type Handler = (
  body: unknown,
  env: ServerEnv,
) => Promise<unknown>

const env = readEnv()
const liveProblems = assertLiveReady(env)

interface AdapterCache {
  sql?: Awaited<ReturnType<typeof createLiveSqlAdapter>>
  cosmos?: Awaited<ReturnType<typeof createLiveCosmosAdapter>>
}
const adapters: AdapterCache = {}

async function getSql() {
  if (!env.liveEnabled) {
    throw new Error('LIVE mode is disabled — set MIGRATION_LIVE=true to enable real SQL writes.')
  }
  if (liveProblems.length > 0) {
    throw new Error(liveProblems.join('; '))
  }
  if (!adapters.sql) adapters.sql = await createLiveSqlAdapter(env)
  return adapters.sql
}

async function getCosmos() {
  if (!env.liveEnabled) {
    throw new Error('LIVE mode is disabled — set MIGRATION_LIVE=true to enable real Cosmos writes.')
  }
  if (liveProblems.length > 0) {
    throw new Error(liveProblems.join('; '))
  }
  if (!adapters.cosmos) adapters.cosmos = await createLiveCosmosAdapter(env)
  return adapters.cosmos
}

const routes: Record<string, Handler> = {
  'GET /api/health': async () => ({
    ok: true,
    mode: env.liveEnabled ? 'LIVE' : 'DRY_RUN',
    liveProblems,
    sql: {
      server: env.sql.server,
      database: env.sql.database,
      schema: env.sql.schema,
    },
    cosmos: {
      endpoint: env.cosmos.endpoint,
      database: env.cosmos.databaseId,
      leads: env.cosmos.leadsContainerId,
      leadsWon: env.cosmos.leadsWonContainerId,
    },
  }),

  'POST /api/sql/validate-connection': async () => (await getSql()).validateConnection(),

  'POST /api/sql/apply-ddl': async () => {
    const sql = await getSql()
    await sql.applyDdl()
    return { ok: true }
  },

  'POST /api/sql/truncate': async () => {
    const sql = await getSql()
    await sql.truncate()
    return { ok: true }
  },

  'POST /api/sql/execute-batch': async (body) => {
    const sql = await getSql()
    const { runId, batchIndex, records } = body as {
      runId: string
      batchIndex: number
      records: SqlRecord[]
    }
    const prepared = await sql.prepareBatch({ runId, batchIndex, records })
    return sql.insertBatch(prepared)
  },

  'POST /api/sql/reconcile': async (body) => {
    const sql = await getSql()
    const { runId, batchIndex, records } = body as {
      runId: string
      batchIndex: number
      records: SqlRecord[]
    }
    const prepared = await sql.prepareBatch({ runId, batchIndex, records })
    return sql.reconcile(prepared)
  },

  'POST /api/sql/rollback-preview': async (body) => {
    const sql = await getSql()
    const { batchId } = body as { batchId: string }
    return sql.previewRollback(batchId)
  },

  'POST /api/cosmos/validate-connection': async () =>
    (await getCosmos()).validateConnection(),

  'POST /api/cosmos/ensure': async () => {
    const cosmos = await getCosmos()
    await cosmos.ensureDatabaseAndContainers()
    return { ok: true }
  },

  'POST /api/cosmos/execute-batch': async (body) => {
    const cosmos = await getCosmos()
    const { runId, batchIndex, records } = body as {
      runId: string
      batchIndex: number
      records: CosmosWritable[]
    }
    const prepared = await cosmos.prepareBatch({ runId, batchIndex, records })
    return cosmos.insertBatch(prepared)
  },

  'POST /api/cosmos/reconcile': async (body) => {
    const cosmos = await getCosmos()
    const { runId, batchIndex, records } = body as {
      runId: string
      batchIndex: number
      records: CosmosWritable[]
    }
    const prepared = await cosmos.prepareBatch({ runId, batchIndex, records })
    return cosmos.reconcile(prepared)
  },
}

const server = http.createServer(async (req, res) => {
  const key = `${req.method} ${req.url?.split('?')[0]}`
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  const handler = routes[key]
  if (!handler) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'not found', route: key }))
    return
  }
  try {
    const body =
      req.method === 'POST' ? await readJsonBody(req) : undefined
    const result = await handler(body, env)
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(result))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = err instanceof Error && /refuse|disabled|empty/i.test(err.message) ? 403 : 500
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: msg }))
  }
})

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf-8')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('invalid JSON body')
  }
}

async function shutdown(reason: string) {
  console.log(`[server] shutting down: ${reason}`)
  await adapters.sql?.close().catch(() => {})
  await adapters.cosmos?.close().catch(() => {})
  server.close(() => process.exit(0))
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

server.listen(env.port, () => {
  console.log(`[server] migration backend listening on :${env.port}`)
  console.log(
    `[server] mode=${env.liveEnabled ? 'LIVE' : 'DRY_RUN'}` +
      (liveProblems.length ? `  (LIVE blocked: ${liveProblems.length} issue${liveProblems.length === 1 ? '' : 's'})` : ''),
  )
})
