/**
 * Backend integration contracts (interface-only).
 *
 * The frontend NEVER speaks to SQL Server, Cosmos, or Lemon Vireya directly
 * in production — all credentials live in the backend runtime. This file
 * declares the HTTP contracts the backend will expose. No concrete fetch
 * client is shipped yet (Phase 2 will land `src/lib/backend/client.ts` using
 * these types). Keeping only shapes here means we can type-check the UI
 * against the eventual API surface without baking any URL / token into the
 * bundle.
 */

import type {
  AdapterBatchResult,
  AdapterConnectionProbe,
  AdapterReconcileReport,
  AdapterRollbackPreview,
} from '@/lib/adapters/types'

export interface BackendRoutes {
  '/api/health': {
    method: 'GET'
    response: { ok: boolean; environment: string }
  }
  '/api/sql/validate-connection': {
    method: 'POST'
    body: { profile: string }
    response: AdapterConnectionProbe
  }
  '/api/sql/execute-batch': {
    method: 'POST'
    body: {
      runId: string
      batchIndex: number
      records: Array<Record<string, unknown>>
      dryRun: boolean
    }
    response: AdapterBatchResult<Record<string, unknown>>
  }
  '/api/sql/reconcile': {
    method: 'POST'
    body: { runId: string; batchId: string }
    response: AdapterReconcileReport
  }
  '/api/sql/rollback-preview': {
    method: 'POST'
    body: { batchId: string }
    response: AdapterRollbackPreview
  }
  '/api/cosmos/validate-connection': {
    method: 'POST'
    body: { emulator: boolean }
    response: AdapterConnectionProbe
  }
  '/api/cosmos/execute-batch': {
    method: 'POST'
    body: {
      runId: string
      batchIndex: number
      records: Array<{ container: string; partitionKey: string; body: unknown }>
      dryRun: boolean
    }
    response: AdapterBatchResult<Record<string, unknown>>
  }
  '/api/cosmos/reconcile': {
    method: 'POST'
    body: { runId: string; batchId: string }
    response: AdapterReconcileReport
  }
  '/api/lemon-vireya/submit': {
    method: 'POST'
    body: { runId: string; batchId: string; payload: unknown }
    response: { status: 'queued' | 'rejected'; message: string }
  }
}

export interface BackendEnvironment {
  mode: 'local' | 'staging' | 'production'
  sqlProfile: string
  cosmosEmulatorEnabled: boolean
  lemonVireyaReady: boolean
}
