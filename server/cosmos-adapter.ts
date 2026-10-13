/**
 * Real Cosmos DB adapter (works against the Linux emulator or a hosted
 * Cosmos account).
 *
 * Writes to the `leads` and `leads-won` containers (partition key `/id` on
 * both). Honours the DestinationAdapter<R> contract.
 */

import {
  CosmosClient,
  type Container,
  type Database,
} from '@azure/cosmos'
import { newBatchId } from '@/lib/transform/identifiers'
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
} from '@/lib/adapters/types'
import type { ServerEnv } from './env'

export type CosmosWritable = CosmosLeadDocument | CosmosWonDocument

interface LiveCosmosAdapter extends DestinationAdapter<CosmosWritable> {
  close(): Promise<void>
  ensureDatabaseAndContainers(): Promise<void>
}

export async function createLiveCosmosAdapter(
  env: ServerEnv,
): Promise<LiveCosmosAdapter> {
  // Node 20+ ships with a strict TLS verifier that rejects the emulator's
  // self-signed certificate. The connection string in the emulator image is
  // documented to require this relaxation.
  if (
    env.cosmos.endpoint.includes('127.0.0.1') ||
    env.cosmos.endpoint.includes('localhost')
  ) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED =
      process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? '0'
  }

  const client = new CosmosClient({
    endpoint: env.cosmos.endpoint,
    key: env.cosmos.key,
  })

  let database: Database
  let leads: Container
  let wonContainer: Container

  const ensureDatabaseAndContainers = async () => {
    const dbResp = await client.databases.createIfNotExists({
      id: env.cosmos.databaseId,
    })
    database = dbResp.database
    const leadsResp = await database.containers.createIfNotExists({
      id: env.cosmos.leadsContainerId,
      partitionKey: { paths: [env.cosmos.partitionKeyPath] },
    })
    leads = leadsResp.container
    const wonResp = await database.containers.createIfNotExists({
      id: env.cosmos.leadsWonContainerId,
      partitionKey: { paths: [env.cosmos.partitionKeyPath] },
    })
    wonContainer = wonResp.container
  }

  const containerForDoc = (doc: CosmosWritable): Container =>
    'originalLeadId' in doc ? wonContainer : leads

  await ensureDatabaseAndContainers()

  const adapter: LiveCosmosAdapter = {
    name: 'Cosmos DB · leads + leads-won (LIVE)',
    mode: 'LIVE',

    async close() {
      await client.dispose?.()
    },

    ensureDatabaseAndContainers,

    async validateConnection(): Promise<AdapterConnectionProbe> {
      const start = Date.now()
      const info = await client.getDatabaseAccount()
      return {
        ok: true,
        mode: 'LIVE',
        destinationLabel: `Cosmos DB · ${env.cosmos.databaseId}/${env.cosmos.leadsContainerId}+${env.cosmos.leadsWonContainerId}`,
        version: info.resource?.readableLocations?.[0]?.name ?? 'local',
        latencyMs: Date.now() - start,
        notes: [
          `Endpoint: ${env.cosmos.endpoint}`,
          `Partition key: ${env.cosmos.partitionKeyPath} on both containers.`,
        ],
      }
    },

    async prepareBatch({ runId, batchIndex, records }): Promise<PreparedBatch<CosmosWritable>> {
      const batchId = newBatchId(runId, batchIndex)
      for (const doc of records) {
        if (!doc.id) {
          throw new Error(
            `prepareBatch: Cosmos document missing /id (${batchId})`,
          )
        }
      }
      return { batchId, runId, records, mode: 'LIVE' }
    },

    async insertBatch(batch): Promise<AdapterBatchResult<CosmosWritable>> {
      const startedAt = new Date().toISOString()
      let inserted = 0
      let conflicts = 0
      let failed = 0
      const perRecord: AdapterBatchResult<CosmosWritable>['perRecord'] = []
      for (let i = 0; i < batch.records.length; i++) {
        const doc = batch.records[i]
        try {
          await containerForDoc(doc).items.create(doc, {
            disableAutomaticIdGeneration: true,
          })
          inserted++
          perRecord.push({
            recordHash: doc.id,
            rowIndex: i + 1,
            status: 'inserted',
            simulated: false,
            record: doc,
          })
        } catch (err) {
          const e = err as { code?: number; message?: string }
          if (e.code === 409) {
            conflicts++
            perRecord.push({
              recordHash: doc.id,
              rowIndex: i + 1,
              status: 'conflict',
              reason: `409 Conflict (id=${doc.id}) — idempotent skip`,
              simulated: false,
            })
          } else {
            failed++
            perRecord.push({
              recordHash: doc.id,
              rowIndex: i + 1,
              status: 'failed',
              reason: e.message ?? String(err),
              simulated: false,
            })
          }
        }
      }
      return {
        batchId: batch.batchId,
        mode: 'LIVE',
        inserted,
        skipped: 0,
        conflicts,
        failed,
        startedAt,
        finishedAt: new Date().toISOString(),
        perRecord,
        warnings: [],
      }
    },

    async verifyInsertedRecords(batch) {
      const missing: string[] = []
      let verified = 0
      for (const doc of batch.records) {
        try {
          const resp = await containerForDoc(doc)
            .item(doc.id, doc.id)
            .read()
          if (resp.resource) verified++
          else missing.push(doc.id)
        } catch (err) {
          const e = err as { code?: number }
          if (e.code === 404) missing.push(doc.id)
          else missing.push(doc.id)
        }
      }
      return { verified, missingHashes: missing }
    },

    async previewRollback(batchId): Promise<AdapterRollbackPreview> {
      return {
        batchId,
        marker: 'migrated',
        wouldDelete: 0,
        sampleIds: [],
        warnings: [
          'Cosmos rollback is scoped by the caller supplying the ids from the manifest; no automatic bulk delete is attempted.',
        ],
      }
    },

    async reconcile(batch): Promise<AdapterReconcileReport> {
      const verified = await adapter.verifyInsertedRecords(batch)
      return {
        batchId: batch.batchId,
        expected: batch.records.length,
        observed: batch.records.length - verified.missingHashes.length,
        missing: verified.missingHashes,
        extra: [],
        mismatchedHashes: [],
        reconciledAt: new Date().toISOString(),
      }
    },
  }

  return adapter
}
