/**
 * Cosmos DB adapter — MOCK implementation.
 *
 * Writes to both `leads` and `leads-won` containers (both partitioned on
 * `/id`). All results are simulated and labelled with `mode: 'MOCK'`. The
 * adapter honours DRY_RUN=true by refusing the write (`skipped`).
 */

import { newBatchId } from '@/lib/transform/identifiers'
import {
  COSMOS_LEADS_CONTAINER,
  COSMOS_LEADS_WON_CONTAINER,
  COSMOS_PARTITION_KEY,
} from '@/config/cosmos-mapping'
import type {
  CosmosLeadDocument,
  CosmosWonDocument,
} from '@/lib/transform/cosmos-generator'
import type {
  AdapterBatchResult,
  AdapterConnectionProbe,
  AdapterReconcileReport,
  AdapterRollbackPreview,
  DestinationAdapter,
  PreparedBatch,
} from './types'

export type CosmosWritable = CosmosLeadDocument | CosmosWonDocument

const MIGRATION_MARKER = 'MIGRATION_V1'

export interface MockCosmosAdapterOptions {
  failIds?: string[]
  conflictIds?: string[]
  latencyMs?: number
  dryRun?: boolean
}

export function createMockCosmosAdapter(
  options: MockCosmosAdapterOptions = {},
): DestinationAdapter<CosmosWritable> {
  const latency = options.latencyMs ?? 15
  const containers: Record<string, Map<string, CosmosWritable>> = {
    [COSMOS_LEADS_CONTAINER]: new Map<string, CosmosWritable>(),
    [COSMOS_LEADS_WON_CONTAINER]: new Map<string, CosmosWritable>(),
  }
  const batches = new Map<string, PreparedBatch<CosmosWritable>>()

  const containerFor = (doc: CosmosWritable): string =>
    'originalLeadId' in doc ? COSMOS_LEADS_WON_CONTAINER : COSMOS_LEADS_CONTAINER

  return {
    name: 'MOCK Cosmos · leads + leads-won',
    mode: 'MOCK',

    async validateConnection(): Promise<AdapterConnectionProbe> {
      await delay(latency)
      return {
        ok: true,
        mode: 'MOCK',
        destinationLabel: `Cosmos DB · ${COSMOS_LEADS_CONTAINER} + ${COSMOS_LEADS_WON_CONTAINER} (${COSMOS_PARTITION_KEY})`,
        version: 'MOCK-COSMOS-0.1',
        latencyMs: latency,
        notes: [
          'MOCK adapter — no Cosmos Emulator or hosted Cosmos is contacted.',
          `Partition key is ${COSMOS_PARTITION_KEY} on both containers.`,
          'Replace with a Cosmos SDK client in Phase 2 (same interface).',
        ],
      }
    },

    async prepareBatch({ runId, batchIndex, records }): Promise<PreparedBatch<CosmosWritable>> {
      await delay(latency)
      const batchId = newBatchId(runId, batchIndex)
      const stamped = records.map((r) => ({ ...r, migrationBatchId: batchId }))
      for (const doc of stamped) {
        if (!doc.id) {
          throw new Error(`prepareBatch: Cosmos document is missing /id (${batchId})`)
        }
      }
      const prepared: PreparedBatch<CosmosWritable> = {
        batchId,
        runId,
        records: stamped,
        mode: 'MOCK',
      }
      batches.set(batchId, prepared)
      return prepared
    },

    async insertBatch(batch): Promise<AdapterBatchResult<CosmosWritable>> {
      await delay(latency)
      const startedAt = new Date().toISOString()
      let inserted = 0
      let skipped = 0
      let conflicts = 0
      let failed = 0
      const perRecord: AdapterBatchResult<CosmosWritable>['perRecord'] = []
      for (const doc of batch.records) {
        const containerName = containerFor(doc)
        const container = containers[containerName]
        if (options.failIds?.includes(doc.id)) {
          failed++
          perRecord.push({
            recordHash: doc.id,
            rowIndex: 0,
            status: 'failed',
            reason: 'MOCK-FAIL (adapter configured to fail this id)',
            simulated: true,
          })
          continue
        }
        if (options.dryRun === true) {
          skipped++
          perRecord.push({
            recordHash: doc.id,
            rowIndex: 0,
            status: 'skipped',
            reason: 'DRY_RUN=true — adapter refuses to insert',
            simulated: true,
          })
          continue
        }
        if (options.conflictIds?.includes(doc.id) || container.has(doc.id)) {
          conflicts++
          perRecord.push({
            recordHash: doc.id,
            rowIndex: 0,
            status: 'conflict',
            reason: `Id already present in ${containerName} — upsert policy to be decided`,
            simulated: true,
          })
          continue
        }
        container.set(doc.id, doc)
        inserted++
        perRecord.push({
          recordHash: doc.id,
          rowIndex: 0,
          status: 'inserted',
          simulated: true,
          record: doc,
        })
      }
      return {
        batchId: batch.batchId,
        mode: 'MOCK',
        inserted,
        skipped,
        conflicts,
        failed,
        startedAt,
        finishedAt: new Date().toISOString(),
        perRecord,
        warnings: ['MOCK Cosmos adapter — numbers are simulated.'],
      }
    },

    async verifyInsertedRecords(batch) {
      await delay(latency)
      const missing: string[] = []
      let verified = 0
      for (const doc of batch.records) {
        const container = containers[containerFor(doc)]
        if (container.has(doc.id)) verified++
        else missing.push(doc.id)
      }
      return { verified, missingHashes: missing }
    },

    async previewRollback(batchId): Promise<AdapterRollbackPreview> {
      await delay(latency)
      const batch = batches.get(batchId)
      if (!batch) {
        return {
          batchId,
          marker: MIGRATION_MARKER,
          wouldDelete: 0,
          sampleIds: [],
          warnings: [`Unknown batch ${batchId}.`],
        }
      }
      const ids = batch.records.map((r) => r.id)
      const matching = ids.filter((id) => {
        for (const c of Object.values(containers)) if (c.has(id)) return true
        return false
      })
      return {
        batchId,
        marker: MIGRATION_MARKER,
        wouldDelete: matching.length,
        sampleIds: matching.slice(0, 5),
        warnings: [
          `Rollback scoped to migrationBatchId='${batchId}' AND migrationMarker='${MIGRATION_MARKER}'.`,
          'MOCK adapter — the preview reflects simulated inserts, not real documents.',
        ],
      }
    },

    async reconcile(batch): Promise<AdapterReconcileReport> {
      await delay(latency)
      const expected = batch.records.length
      let observed = 0
      const missing: string[] = []
      for (const doc of batch.records) {
        const container = containers[containerFor(doc)]
        if (container.has(doc.id)) observed++
        else missing.push(doc.id)
      }
      return {
        batchId: batch.batchId,
        expected,
        observed,
        missing,
        extra: [],
        mismatchedHashes: [],
        reconciledAt: new Date().toISOString(),
      }
    },
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
