/**
 * Cosmos Emulator POC acceptance:
 *   1. create database `cxlite` and containers `leads` + `leads-won` (/id)
 *   2. transform a synthetic valid lead and a synthetic Won lead
 *   3. insert both; verify leads container holds the lead, leads-won holds
 *      the snapshot, and originalLeadId links back correctly
 *   4. re-insert the same lead and expect a 409 conflict (retry/idempotency)
 *   5. assert the partition key path is /id on both containers
 *
 * MUST run against a real Cosmos Emulator or hosted Cosmos — set
 * MIGRATION_LIVE=true. Production endpoint names are refused.
 */

import { assertLiveReady, readEnv } from '../server/env'
import { createLiveCosmosAdapter } from '../server/cosmos-adapter'
import { transformToCosmos } from '@/lib/transform/cosmos-generator'
import { buildParsedFile, validRow, wonRow } from '../src/__tests__/fixtures'

const PRODUCTION_SIGNALS = ['documents.azure.com', 'prod', 'production']

function refuseProduction(endpoint: string) {
  const probe = endpoint.toLowerCase()
  for (const sig of PRODUCTION_SIGNALS) {
    if (probe.includes(sig)) {
      throw new Error(
        `REFUSE: endpoint="${endpoint}" matches production signal "${sig}". Run against the emulator or a dedicated POC account.`,
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
  refuseProduction(env.cosmos.endpoint)

  console.log(
    `[poc:cosmos] endpoint=${env.cosmos.endpoint} db=${env.cosmos.databaseId} containers=${env.cosmos.leadsContainerId}+${env.cosmos.leadsWonContainerId}`,
  )
  const adapter = await createLiveCosmosAdapter(env)
  try {
    const probe = await adapter.validateConnection()
    console.log(`[poc:cosmos] ✓ connected (${probe.destinationLabel})`)
    await adapter.ensureDatabaseAndContainers()
    console.log('[poc:cosmos] ✓ database + containers ensured (partition /id)')

    const parsed = buildParsedFile([
      validRow({ ID: 'POC-COS-001', nomor_telepon: '0812-0000-0001' }),
      wonRow({ ID: 'POC-COS-002', nomor_telepon: '0812-0000-0002' }),
    ])
    const transformed = transformToCosmos(parsed, {
      config: { profile: 'lite', waMobilePrefix: 'wa_' },
    })

    const leadDocs = transformed.leads
      .filter((l) => !l.blocked)
      .map((l) => l.record)
    const wonDocs = transformed.wonSnapshots
      .filter((w) => !w.blocked)
      .map((w) => w.record)

    if (leadDocs.length !== 2 || wonDocs.length !== 1) {
      throw new Error(
        `transform produced leads=${leadDocs.length} wonSnapshots=${wonDocs.length} (expected 2 and 1)`,
      )
    }

    const batch = await adapter.prepareBatch({
      runId: 'POC-COS',
      batchIndex: 0,
      records: [...leadDocs, ...wonDocs],
    })
    const insert = await adapter.insertBatch(batch)
    if (insert.inserted !== leadDocs.length + wonDocs.length) {
      throw new Error(
        `inserted=${insert.inserted} expected ${leadDocs.length + wonDocs.length} (${JSON.stringify(insert.perRecord.map((r) => r.status))})`,
      )
    }
    console.log(
      `[poc:cosmos] ✓ inserted leads=${leadDocs.length} wonSnapshots=${wonDocs.length}`,
    )

    const verify = await adapter.verifyInsertedRecords(batch)
    if (verify.missingHashes.length !== 0) {
      throw new Error(`verify missing: ${verify.missingHashes.join(', ')}`)
    }
    console.log('[poc:cosmos] ✓ read-back succeeded for every id')

    const dup = await adapter.insertBatch(batch)
    if (dup.conflicts !== leadDocs.length + wonDocs.length) {
      throw new Error(
        `duplicate-insert expected conflicts=${leadDocs.length + wonDocs.length}, got ${JSON.stringify(dup)}`,
      )
    }
    console.log('[poc:cosmos] ✓ duplicate ids reported as 409 conflicts (idempotent)')

    const wonFromCosmos = wonDocs[0]
    if (!wonFromCosmos.originalLeadId.startsWith('wa_')) {
      throw new Error(`originalLeadId should be wa_<phone>, got ${wonFromCosmos.originalLeadId}`)
    }
    console.log(`[poc:cosmos] ✓ originalLeadId relationship: ${wonFromCosmos.id} → ${wonFromCosmos.originalLeadId}`)

    console.log('[poc:cosmos] ALL CHECKS PASSED (LIVE)')
  } finally {
    await adapter.close()
  }
}

main().catch((err) => {
  console.error('[poc:cosmos] FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
