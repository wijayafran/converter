import { describe, expect, it } from 'vitest'
import {
  buildCosmosBatchArray,
  transformToCosmos,
} from '@/lib/transform/cosmos-generator'
import {
  COSMOS_LEADS_CONTAINER,
  COSMOS_LEADS_WON_CONTAINER,
  COSMOS_WON_ID_CHARSET,
  COSMOS_WON_ID_LENGTH,
} from '@/config/cosmos-mapping'
import { buildParsedFile, validRow, wonRow } from './fixtures'

const liteConfig = { profile: 'lite' as const, waMobilePrefix: 'wa_' }
const proConfig = { profile: 'pro' as const, waMobilePrefix: 'wa_' }

describe('transformToCosmos — Lite profile', () => {
  it('builds wa_<digitsPhone> id as partition key (62… no +)', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToCosmos(parsed, { config: liteConfig })
    const lead = result.leads[0]
    expect(lead.record.id).toBe('wa_6281234567890')
    expect(lead.record.customerPhone).toBe('6281234567890')
  })

  it('one lead per phone — duplicate wa_<phone> is BLOCKED (LEAD_PHONE_CONFLICT)', () => {
    const parsed = buildParsedFile([
      validRow({ ID: 'A' }),
      validRow({ ID: 'B' }),
    ])
    const result = transformToCosmos(parsed, { config: liteConfig })
    for (const l of result.leads) {
      expect(l.blocked).toBe(true)
      expect(l.blockingIssues.some((i) => i.category === 'id-collision')).toBe(true)
    }
  })

  it('writes _partitionKey = lowercased source', () => {
    const parsed = buildParsedFile([validRow({ source_data: 'Referral' })])
    const result = transformToCosmos(parsed, { config: liteConfig })
    expect(result.leads[0].record._partitionKey).toBe('referral')
  })
})

describe('transformToCosmos — Pro profile', () => {
  it('generates UUIDv4 ids', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToCosmos(parsed, { config: proConfig })
    expect(result.leads[0].record.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('(phone + assignedTo) duplicates are BLOCKED', () => {
    const parsed = buildParsedFile([
      validRow({ ID: 'A' }),
      validRow({ ID: 'B' }),
    ])
    const result = transformToCosmos(parsed, { config: proConfig })
    expect(
      result.leads.every((l) =>
        l.blockingIssues.some((i) => i.category === 'duplicate-phone-assignee'),
      ),
    ).toBe(true)
  })

  it('allows same phone when assignedTo differs', () => {
    const parsed = buildParsedFile([
      validRow({ ID: 'A', sales_rep: 'Agent One' }),
      validRow({ ID: 'B', sales_rep: 'Agent Two' }),
    ])
    const result = transformToCosmos(parsed, { config: proConfig })
    expect(result.leads.every((l) => !l.blocked)).toBe(true)
  })
})

describe('Won snapshot — real CXLite shape', () => {
  it('emits a snapshot with originalLeadId when all required fields present', () => {
    const parsed = buildParsedFile([wonRow()])
    const result = transformToCosmos(parsed, { config: liteConfig })
    expect(result.wonSnapshots).toHaveLength(1)
    const w = result.wonSnapshots[0]
    expect(w.blocked).toBe(false)
    expect(w.record.originalLeadId).toBe(result.leads[0].record.id)
    expect(w.record.status).toBe('Won')
    expect(w.record.blok).toBe('A')
    expect(w.record.unitNumber).toBe('A-12')
    expect(w.record.dealValue).toBe('2500000000')
  })

  it('id is 6 chars from allowed charset, _partitionKey = id', () => {
    const parsed = buildParsedFile([wonRow()])
    const result = transformToCosmos(parsed, { config: liteConfig })
    const w = result.wonSnapshots[0]
    expect(w.record.id).toHaveLength(COSMOS_WON_ID_LENGTH)
    for (const ch of w.record.id) expect(COSMOS_WON_ID_CHARSET).toContain(ch)
    expect(w.record._partitionKey).toBe(w.record.id)
  })

  it('BLOCKS a Won snapshot missing KTP (not exactly 16 digits)', () => {
    const parsed = buildParsedFile([wonRow({ ktp: '12345' })])
    const result = transformToCosmos(parsed, { config: liteConfig })
    const w = result.wonSnapshots[0]
    expect(w.blocked).toBe(true)
    expect(w.blockingIssues.some((i) => i.field === 'ktp')).toBe(true)
  })

  it('BLOCKS a Won snapshot missing blok/unitNumber', () => {
    const parsed = buildParsedFile([wonRow({ block: '', unit_number: '' })])
    const result = transformToCosmos(parsed, { config: liteConfig })
    const w = result.wonSnapshots[0]
    expect(w.blocked).toBe(true)
    expect(w.blockingIssues.map((i) => i.field)).toEqual(
      expect.arrayContaining(['blok', 'unitNumber']),
    )
  })

  it('BLOCKS dealValue > 1 trillion IDR', () => {
    const parsed = buildParsedFile([wonRow({ deal_value: '2000000000000' })])
    const result = transformToCosmos(parsed, { config: liteConfig })
    expect(result.wonSnapshots[0].blocked).toBe(true)
  })

  it('refuses to downgrade: lead stays Won even if snapshot blocked', () => {
    const parsed = buildParsedFile([wonRow({ ktp: '' })])
    const result = transformToCosmos(parsed, { config: liteConfig })
    expect(result.leads[0].record.status).toBe('Won')
  })
})

describe('No fabricated AI metadata / system fields', () => {
  it('emits interactions=[] and reassignmentTriedAgents=[] (empty, not fabricated)', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToCosmos(parsed, { config: liteConfig })
    const r = result.leads[0].record
    expect(r.interactions).toEqual([])
    expect(r.reassignmentTriedAgents).toEqual([])
  })

  it('does not emit Cosmos system metadata (_rid, _etag, _self, _ts)', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToCosmos(parsed, { config: liteConfig })
    const keys = Object.keys(result.leads[0].record)
    for (const sys of ['_rid', '_etag', '_self', '_attachments', '_ts']) {
      expect(keys).not.toContain(sys)
    }
  })

  it('does not emit AI-generated blocks', () => {
    const parsed = buildParsedFile([validRow()])
    const result = transformToCosmos(parsed, { config: liteConfig })
    const keys = Object.keys(result.leads[0].record)
    for (const ai of ['aiSummary', 'lead_score_data', 'message_history', 'rag_interactions', 'property_data']) {
      expect(keys).not.toContain(ai)
    }
  })
})

describe('Batch array routing', () => {
  it('routes leads → leads container, won → leads-won container', () => {
    const parsed = buildParsedFile([validRow(), wonRow()])
    const result = transformToCosmos(parsed, { config: liteConfig })
    const batch = buildCosmosBatchArray(result)
    const containers = new Set(batch.map((b) => b.container))
    expect(containers.has(COSMOS_LEADS_CONTAINER)).toBe(true)
    expect(containers.has(COSMOS_LEADS_WON_CONTAINER)).toBe(true)
    for (const b of batch) {
      expect(b.partitionKey).toBeTruthy()
    }
  })
})
