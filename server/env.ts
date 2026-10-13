/**
 * Server-side environment reader.
 *
 * Secrets live only in process.env; the browser bundle never imports this
 * file. Every value has a safe local-only default so a developer can run
 * `npm run server` without having to invent credentials, but LIVE mode
 * requires both the SQL password and the Cosmos emulator key.
 *
 * `.env` is auto-loaded on import if present. This matches what
 * `node --env-file=.env` would do, but without relying on Node CLI flags
 * (NODE_OPTIONS forbids `--env-file-if-exists`), and keeps the behaviour
 * consistent across `npm run server`, `npm run poc:*`, and the smoke /
 * verify scripts.
 */

import fs from 'node:fs'
import path from 'node:path'
import 'node:process'

loadDotEnvOnce()

function loadDotEnvOnce() {
  const marker = Symbol.for('lemons.dotenv.loaded')
  const g = globalThis as unknown as Record<symbol, boolean>
  if (g[marker]) return
  g[marker] = true
  const envPath = path.resolve(process.cwd(), '.env')
  let text: string
  try {
    text = fs.readFileSync(envPath, 'utf-8')
  } catch {
    return
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    // Never override values the caller already exported in the shell.
    if (process.env[key] === undefined) process.env[key] = value
  }
}

export interface ServerEnv {
  port: number
  liveEnabled: boolean
  sql: {
    server: string
    port: number
    user: string
    password: string
    database: string
    trustServerCertificate: boolean
    schema: string
    requestTimeoutMs: number
  }
  cosmos: {
    endpoint: string
    key: string
    databaseId: string
    leadsContainerId: string
    leadsWonContainerId: string
    partitionKeyPath: string
  }
}

const DEFAULTS = {
  port: 4318,
  sqlPort: 1433,
  sqlUser: 'sa',
  sqlDatabase: 'cxlite_poc',
  sqlSchema: 'dev_analytic_cxlite',
  cosmosDatabase: 'cxlite',
  cosmosLeads: 'leads',
  cosmosLeadsWon: 'leads-won',
  partitionKey: '/id',
  /** Local emulator well-known development key — not a real secret. */
  cosmosEmulatorKey:
    'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==',
}

export function readEnv(): ServerEnv {
  const port = numberFromEnv('MIGRATION_SERVER_PORT', DEFAULTS.port)
  const liveEnabled =
    boolFromEnv('MIGRATION_LIVE', false) ||
    boolFromEnv('MIGRATION_SERVER_LIVE', false)

  return {
    port,
    liveEnabled,
    sql: {
      server: process.env.SQL_SERVER_HOST ?? '127.0.0.1',
      port: numberFromEnv('SQL_SERVER_PORT', DEFAULTS.sqlPort),
      user: process.env.SQL_SERVER_USER ?? DEFAULTS.sqlUser,
      password: process.env.SQL_SERVER_PASSWORD ?? '',
      database: process.env.SQL_SERVER_DATABASE ?? DEFAULTS.sqlDatabase,
      trustServerCertificate: boolFromEnv('SQL_SERVER_TRUST_CERT', true),
      schema: process.env.SQL_SERVER_SCHEMA ?? DEFAULTS.sqlSchema,
      requestTimeoutMs: numberFromEnv('SQL_SERVER_REQUEST_TIMEOUT_MS', 15_000),
    },
    cosmos: {
      endpoint: process.env.COSMOS_ENDPOINT ?? 'https://127.0.0.1:8081',
      key: process.env.COSMOS_KEY ?? DEFAULTS.cosmosEmulatorKey,
      databaseId: process.env.COSMOS_DATABASE ?? DEFAULTS.cosmosDatabase,
      leadsContainerId: process.env.COSMOS_LEADS_CONTAINER ?? DEFAULTS.cosmosLeads,
      leadsWonContainerId:
        process.env.COSMOS_LEADS_WON_CONTAINER ?? DEFAULTS.cosmosLeadsWon,
      partitionKeyPath: process.env.COSMOS_PARTITION_KEY ?? DEFAULTS.partitionKey,
    },
  }
}

export function assertLiveReady(env: ServerEnv): string[] {
  const problems: string[] = []
  if (!env.sql.password) {
    problems.push(
      'LIVE: SQL_SERVER_PASSWORD env is empty — refuse to attempt a real SQL connection.',
    )
  }
  if (!env.cosmos.key) {
    problems.push(
      'LIVE: COSMOS_KEY env is empty — refuse to attempt a real Cosmos connection.',
    )
  }
  return problems
}

function numberFromEnv(key: string, fallback: number): number {
  const raw = process.env[key]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function boolFromEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key]
  if (raw === undefined) return fallback
  const s = raw.trim().toLowerCase()
  if (['1', 'true', 't', 'yes', 'y', 'on'].includes(s)) return true
  if (['0', 'false', 'f', 'no', 'n', 'off'].includes(s)) return false
  return fallback
}
