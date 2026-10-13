/**
 * Lemon Vireya API — interface stub.
 *
 * The Vireya endpoints, authentication model, and batch contract have NOT
 * been shared with engineering. This file exists to:
 *
 *   1. Nail down the TypeScript shape so the UI, batch engine, and tests can
 *      compile against a stable contract.
 *   2. Make it obvious that no endpoints or secrets have been invented — the
 *      stub throws on any `send` attempt until Phase 2 wires the real client.
 *
 * DO NOT populate `baseUrl`, `authHeader`, or `authToken` with real values
 * in this file. Secrets must come from the backend layer at runtime.
 */

import type { CosmosLeadDocument, CosmosWonDocument } from '@/lib/transform/cosmos-generator'

export interface LemonVireyaCredentials {
  baseUrl: string
  tenant?: string
  apiVersion?: string
  authToken?: string
}

export interface LemonVireyaClient {
  readonly ready: boolean
  readonly notes: string[]
  send(payload: LemonVireyaBatch): Promise<LemonVireyaBatchAck>
  describe(): LemonVireyaMetadata
}

export interface LemonVireyaBatch {
  batchId: string
  runId: string
  dryRun: boolean
  leads: CosmosLeadDocument[]
  wonSnapshots: CosmosWonDocument[]
}

export interface LemonVireyaBatchAck {
  batchId: string
  accepted: number
  rejected: number
  acknowledgedAt: string
  simulated: boolean
}

export interface LemonVireyaMetadata {
  endpointsKnown: boolean
  authKnown: boolean
  idempotencyKnown: boolean
  rateLimitsKnown: boolean
}

export function createLemonVireyaStub(): LemonVireyaClient {
  return {
    ready: false,
    notes: [
      'Lemon Vireya endpoints, authentication, and batch contract are not yet shared with engineering.',
      'This stub exists only to lock down the TypeScript interface — do not invent endpoints.',
      'Replace with a real client in Phase 2 once the API contract is published.',
    ],
    async send(): Promise<LemonVireyaBatchAck> {
      throw new Error(
        'Lemon Vireya client is a Phase 1 stub — no real request will be made. ' +
          'Wait for the authoritative API contract before enabling this path.',
      )
    },
    describe(): LemonVireyaMetadata {
      return {
        endpointsKnown: false,
        authKnown: false,
        idempotencyKnown: false,
        rateLimitsKnown: false,
      }
    },
  }
}
