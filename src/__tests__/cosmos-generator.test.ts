import { describe, expect, it } from 'vitest'
import {
  buildCosmosBatchArray,
  transformToCosmos,
} from '@/lib/transform/cosmos-generator'
import {
  COSMOS_LEADS_CONTAINER,
  COSMOS_LEADS_WON_CONTAINER,
} from '@/config/cosmos-mapping'
import { buildParsedFile, validRow, wonRow } from './fixtures'

describe('transformToCosmos — Lite profile', () => {
  it('builds wa_<phone> id as the partition key', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToCosmos(parsed, {
      config: { profile: 'lite', waMobilePrefix: 'wa_' },
    })
    const lead = result.leads[0]
    expect(lead.record.id).toBe('wa_6281234567890')
  })

  it('blocks on duplicate phone (one lead per phone rule)', () => {
    const parsed = buildParsedFile([
      validRow({ ID: 'A' }),
      validRow({ ID: 'B' }),
    ])
    const result = transformToCosmos(parsed, {
      config: { profile: 'lite', waMobilePrefix: 'wa_' },
    })
    for (const l of result.leads) {
      expect(l.blocked).toBe(true)
      expect(l.blockingIssues.some((i) => i.category === 'id-collision')).toBe(true)
    }
  })
})

describe('transformToCosmos — Pro profile', () => {
  it('generates UUIDv4 ids (not wa_<phone>)', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToCosmos(parsed, {
      config: { profile: 'pro', waMobilePrefix: 'wa_' },
    })
    expect(result.leads[0].record.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('warns (not blocks) on same phone + different legacy IDs', () => {
    const parsed = buildParsedFile([
      validRow({ ID: 'A' }),
      validRow({ ID: 'B' }),
    ])
    const result = transformToCosmos(parsed, {
      config: { profile: 'pro', waMobilePrefix: 'wa_' },
    })
    expect(
      result.leads.every(
        (l) =>
          l.blocked === false ||
          l.blockingIssues.every((i) => i.category !== 'id-collision'),
      ),
    ).toBe(true)
    expect(
      result.leads.some((l) =>
        l.warnings.some((i) => i.category === 'duplicate-phone-assignee'),
      ),
    ).toBe(true)
  })
})

describe('Won snapshot', () => {
  it('emits a snapshot with originalLeadId when all required fields present', () => {
    const parsed = buildParsedFile([wonRow()])
    const result = transformToCosmos(parsed, {
      config: { profile: 'lite', waMobilePrefix: 'wa_' },
    })
    expect(result.wonSnapshots).toHaveLength(1)
    const w = result.wonSnapshots[0]
    expect(w.blocked).toBe(false)
    expect(w.record.originalLeadId).toBe(result.leads[0].record.id)
    expect(w.record.snapshotKind).toBe('won')
  })

  it('BLOCKS a Won snapshot missing KTP', () => {
    const parsed = buildParsedFile([wonRow({ ktp: '' })])
    const result = transformToCosmos(parsed, {
      config: { profile: 'lite', waMobilePrefix: 'wa_' },
    })
    const w = result.wonSnapshots[0]
    expect(w.blocked).toBe(true)
    expect(w.blockingIssues.some((i) => i.field === 'ktp')).toBe(true)
  })

  it('BLOCKS a Won snapshot missing block/unit', () => {
    const parsed = buildParsedFile([wonRow({ block: '', unit_number: '' })])
    const result = transformToCosmos(parsed, {
      config: { profile: 'lite', waMobilePrefix: 'wa_' },
    })
    const w = result.wonSnapshots[0]
    expect(w.blocked).toBe(true)
    expect(w.blockingIssues.map((i) => i.field)).toEqual(
      expect.arrayContaining(['block', 'unitNumber']),
    )
  })

  it('refuses to downgrade a Won status: lead is Won even if snapshot blocked', () => {
    const parsed = buildParsedFile([wonRow({ ktp: '' })])
    const result = transformToCosmos(parsed, {
      config: { profile: 'lite', waMobilePrefix: 'wa_' },
    })
    expect(result.leads[0].record.status).toBe('won')
  })
})

describe('empty histories and system metadata', () => {
  it('emits empty arrays for interactions/chatHistory/assignmentHistory', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToCosmos(parsed, {
      config: { profile: 'lite', waMobilePrefix: 'wa_' },
    })
    const r = result.leads[0].record
    expect(r.interactions).toEqual([])
    expect(r.chatHistory).toEqual([])
    expect(r.assignmentHistory).toEqual([])
  })

  it('does not fabricate Cosmos system metadata (_rid etc)', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToCosmos(parsed, {
      config: { profile: 'lite', waMobilePrefix: 'wa_' },
    })
    const keys = Object.keys(result.leads[0].record)
    expect(keys.filter((k) => k.startsWith('_'))).toEqual([])
  })
})

describe('batch array', () => {
  it('routes leads vs won into their respective containers', () => {
    const parsed = buildParsedFile([validRow(), wonRow()])
    const result = transformToCosmos(parsed, {
      config: { profile: 'lite', waMobilePrefix: 'wa_' },
    })
    const batch = buildCosmosBatchArray(result)
    const containers = new Set(batch.map((b) => b.container))
    expect(containers.has(COSMOS_LEADS_CONTAINER)).toBe(true)
    expect(containers.has(COSMOS_LEADS_WON_CONTAINER)).toBe(true)
    for (const b of batch) {
      expect(b.partitionKey).toBeTruthy()
    }
  })
})
