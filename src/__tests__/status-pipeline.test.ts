import { describe, expect, it } from 'vitest'
import {
  resolveQonexSource,
  resolveQonexStatus,
  sqlGroupStatus,
  sqlStatusUpper,
} from '@/config/status-taxonomy'
import { transformToSqlRecords } from '@/lib/transform/sql-generator'
import { canOverride, runValidation } from '@/lib/validation'
import { buildParsedFile, validRow } from './fixtures'

/**
 * UAT regression suite for the shared Qonex → SQL status pipeline.
 *
 * Every UAT status + source value in the "many warnings" bug report lives
 * here as an explicit test case so a future refactor cannot silently
 * reintroduce the "raw-upper leaks into leads_status while
 * leads_group_status is UNKNOWN" split.
 */

describe('resolveQonexStatus — UAT confirmed mappings', () => {
  const cases: Array<[string, string, string]> = [
    ['Send Brochure', 'In Discussion', 'FOLLOWUP'],
    ['Negotiation Process', 'In Discussion', 'FOLLOWUP'],
    ['Schedule Site Visit', 'Site Visit', 'FOLLOWUP'],
    ['Send Price Simulation', 'In Discussion', 'FOLLOWUP'],
    ['Site Visit With Client', 'Site Visit', 'FOLLOWUP'],
    ['Booking Fee Received', 'Won', 'CLOSED'],
    ['Drop/Lost Opportunity', 'Cancelled', 'CLOSED'],
  ]
  it.each(cases)(
    'raw "%s" → canonical "%s", group %s (known, not pending)',
    (raw, canonical, group) => {
      const r = resolveQonexStatus(raw)
      expect(r.rawOriginal).toBe(raw)
      expect(r.canonical).toBe(canonical)
      expect(r.upper).toBe(canonical.toUpperCase())
      expect(r.group).toBe(group)
      expect(r.known).toBe(true)
      expect(r.pending).toBe(false)
    },
  )
})

describe('resolveQonexStatus — pending FSM group', () => {
  it('"Send Pricelist" preserves canonical "Discussion" and marks group PENDING', () => {
    const r = resolveQonexStatus('Send Pricelist')
    expect(r.rawOriginal).toBe('Send Pricelist')
    // Explicit preservation — must NOT be silently rewritten to "In Discussion".
    expect(r.canonical).toBe('Discussion')
    expect(r.canonical).not.toBe('In Discussion')
    expect(r.upper).toBe('DISCUSSION')
    expect(r.group).toBe('PENDING')
    expect(r.known).toBe(true)
    expect(r.pending).toBe(true)
    expect(r.reason).toContain('Discussion')
  })

  it('"Follow Up Leads" is PENDING with reason recorded', () => {
    const r = resolveQonexStatus('Follow Up Leads')
    expect(r.rawOriginal).toBe('Follow Up Leads')
    expect(r.canonical).toBe('Follow Up Leads')
    expect(r.group).toBe('PENDING')
    expect(r.pending).toBe(true)
    expect(r.reason).toMatch(/pending/i)
  })
})

describe('resolveQonexStatus — truly unknown', () => {
  it('unknown raw → canonical null, group UNKNOWN, reason set', () => {
    const r = resolveQonexStatus('COMPLETELY MADE UP STATUS')
    expect(r.canonical).toBeNull()
    expect(r.upper).toBeNull()
    expect(r.group).toBe('UNKNOWN')
    expect(r.known).toBe(false)
    expect(r.pending).toBe(false)
    expect(r.reason).toContain('No canonical mapping')
  })

  it('empty / null raw → UNKNOWN but reason explains blankness', () => {
    for (const raw of [null, undefined, '', '   ']) {
      const r = resolveQonexStatus(raw)
      expect(r.group).toBe('UNKNOWN')
      expect(r.canonical).toBeNull()
      expect(r.rawOriginal).toBeNull()
    }
  })
})

describe('sqlStatusUpper / sqlGroupStatus route through the shared pipeline', () => {
  it('both helpers agree on the same raw input (no drift)', () => {
    for (const raw of [
      'Send Brochure',
      'Negotiation Process',
      'Schedule Site Visit',
      'Send Price Simulation',
      'Site Visit With Client',
      'Booking Fee Received',
      'Drop/Lost Opportunity',
    ]) {
      const r = resolveQonexStatus(raw)
      expect(sqlStatusUpper(raw)).toBe(r.upper)
      expect(sqlGroupStatus(raw)).toBe(r.group)
    }
  })
})

describe('SQL generator — UAT statuses produce correct columns', () => {
  it('each UAT status writes correct leads_status + leads_group_status, no UNKNOWN warnings', () => {
    const uat = [
      ['Send Brochure', 'IN DISCUSSION', 'FOLLOWUP'],
      ['Negotiation Process', 'IN DISCUSSION', 'FOLLOWUP'],
      ['Schedule Site Visit', 'SITE VISIT', 'FOLLOWUP'],
      ['Send Price Simulation', 'IN DISCUSSION', 'FOLLOWUP'],
      ['Site Visit With Client', 'SITE VISIT', 'FOLLOWUP'],
      ['Booking Fee Received', 'WON', 'CLOSED'],
      ['Drop/Lost Opportunity', 'CANCELLED', 'CLOSED'],
    ] as const
    for (const [status, expectedUpper, expectedGroup] of uat) {
      const parsed = buildParsedFile([
        validRow({ ID: `QX-${expectedGroup}`, nomor_telepon: `0812-0000-${String(Math.abs(status.length * 7)).padStart(4, '0')}`, status }),
      ])
      const result = transformToSqlRecords(parsed)
      const r = result.records[0]
      expect(r.record.leads_status).toBe(expectedUpper)
      expect(r.record.leads_group_status).toBe(expectedGroup)
      expect(r.blocked).toBe(false)
      // No false UNKNOWN classifications anywhere on the row.
      expect(r.issues.some((i) => i.category === 'unresolved-status')).toBe(false)
      expect(r.issues.some((i) => i.category === 'pending-status-mapping')).toBe(false)
    }
  })

  it('"Send Pricelist" row BLOCKS on pending-status-mapping (not overridable)', () => {
    const parsed = buildParsedFile([validRow({ status: 'Send Pricelist' })])
    const result = transformToSqlRecords(parsed)
    const r = result.records[0]
    expect(r.blocked).toBe(true)
    expect(r.record.leads_status).toBe('DISCUSSION')
    expect(r.record.leads_group_status).toBeNull()
    const flag = r.blockingIssues.find((i) => i.category === 'pending-status-mapping')
    expect(flag).toBeDefined()
    expect(flag?.originalValue).toBe('Send Pricelist')
  })

  it('"Follow Up Leads" row BLOCKS on pending-status-mapping', () => {
    const parsed = buildParsedFile([validRow({ status: 'Follow Up Leads' })])
    const result = transformToSqlRecords(parsed)
    const r = result.records[0]
    expect(r.blocked).toBe(true)
    const flag = r.blockingIssues.find((i) => i.category === 'pending-status-mapping')
    expect(flag).toBeDefined()
    expect(flag?.proposedValue).toContain('PENDING')
  })

  it('unresolved status BLOCKS the row and nulls the group (no UNKNOWN leaks)', () => {
    const parsed = buildParsedFile([validRow({ status: 'SomethingNovel' })])
    const result = transformToSqlRecords(parsed)
    const r = result.records[0]
    expect(r.blocked).toBe(true)
    expect(r.record.leads_group_status).toBeNull()
    expect(r.record.leads_status).toBeNull()
    const flag = r.blockingIssues.find((i) => i.category === 'unresolved-status')
    expect(flag).toBeDefined()
    expect(flag?.originalValue).toBe('SomethingNovel')
    expect(flag?.proposedValue).toBeNull()
  })
})

describe('resolveQonexSource — UAT values (Phase 2C: never auto-apply proposals)', () => {
  const pending: Array<[string, string]> = [
    ['Rumah123', 'Partnership'],
    ['SML Website', 'Official Website'],
    ['Official - FB IG Ads Form', 'Facebook Lead Ads'],
    ['Website Ecovia', 'Official Website'],
  ]
  it.each(pending)(
    'Qonex-known "%s" preserves raw in canonical; proposed "%s" is metadata only',
    (raw, proposed) => {
      const r = resolveQonexSource(raw)
      expect(r.rawOriginal).toBe(raw)
      expect(r.qonexKnown).toBe(true)
      expect(r.cxliteApproved).toBe(false)
      expect(r.pending).toBe(true)
      // Phase 2C contract: canonical is the raw string, NEVER the proposal.
      expect(r.canonical).toBe(raw)
      expect(r.canonical).not.toBe(proposed)
      expect(r.proposedCanonical).toBe(proposed)
    },
  )

  it('"Referrals" (plural) normalises to approved canonical "Referral"', () => {
    const r = resolveQonexSource('Referrals')
    expect(r.canonical).toBe('Referral')
    expect(r.proposedCanonical).toBeNull()
    expect(r.qonexKnown).toBe(true)
    expect(r.cxliteApproved).toBe(true)
    expect(r.pending).toBe(false)
  })

  it('fully unknown source preserves raw and marks !qonexKnown, !cxliteApproved', () => {
    const r = resolveQonexSource('BrandNewChannel')
    expect(r.qonexKnown).toBe(false)
    expect(r.cxliteApproved).toBe(false)
    expect(r.pending).toBe(false)
    expect(r.canonical).toBe('BrandNewChannel')
    expect(r.proposedCanonical).toBeNull()
    expect(r.reason).toContain('Unknown')
  })
})

describe('SQL generator — UAT sources produce the right issues (Phase 2C)', () => {
  it('pending source: leads_source stays raw; proposal is metadata on the issue', () => {
    const parsed = buildParsedFile([validRow({ source_data: 'Rumah123' })])
    const result = transformToSqlRecords(parsed)
    const r = result.records[0]
    // SQL output preserves the Qonex raw value verbatim.
    expect(r.record.leads_source).toBe('Rumah123')
    expect(r.record.leads_channel).toBe('RUMAH123')
    const warn = r.warnings.find((i) => i.category === 'pending-source-mapping')
    expect(warn).toBeDefined()
    expect(warn?.originalValue).toBe('Rumah123')
    expect(warn?.proposedValue).toBe('Partnership')
    // Validation engine side: not overridable (bulk approve cannot silently
    // promote the proposal to production output).
    const vResult = runValidation({ destination: 'sql', parsed })
    const vIssue = vResult.issues.find((i) => i.category === 'pending-source-mapping')
    expect(vIssue).toBeDefined()
    expect(canOverride(vIssue!)).toBe(false)
  })

  it('every pending UAT source preserves the raw in both leads_source and leads_channel', () => {
    const inputs: Array<[string, string]> = [
      ['Rumah123', 'RUMAH123'],
      ['SML Website', 'SML WEBSITE'],
      ['Official - FB IG Ads Form', 'OFFICIAL - FB IG ADS FORM'],
      ['Website Ecovia', 'WEBSITE ECOVIA'],
    ]
    for (const [raw, upper] of inputs) {
      const parsed = buildParsedFile([validRow({ source_data: raw })])
      const result = transformToSqlRecords(parsed)
      const r = result.records[0]
      expect(r.record.leads_source).toBe(raw)
      expect(r.record.leads_channel).toBe(upper)
    }
  })

  it('approved source "Referral" (and plural variant) emits no source warning', () => {
    for (const src of ['Referral', 'Referrals']) {
      const parsed = buildParsedFile([validRow({ source_data: src })])
      const result = transformToSqlRecords(parsed)
      const r = result.records[0]
      expect(r.record.leads_source).toBe('Referral')
      expect(r.record.leads_channel).toBe('REFERRAL')
      expect(r.warnings.some((i) => i.category === 'pending-source-mapping')).toBe(false)
      expect(r.warnings.some((i) => i.category === 'unknown-source')).toBe(false)
    }
  })
})

describe('Preview = inserted SQL-ready record (same object)', () => {
  it('leads_status and leads_group_status match between pre-insert record and SqlRecord', () => {
    const parsed = buildParsedFile([
      validRow({ status: 'Send Brochure' }),
      validRow({ ID: 'QX-2', nomor_telepon: '0812-0000-0002', status: 'Booking Fee Received' }),
    ])
    const result = transformToSqlRecords(parsed)
    const previewRecords = result.records
      .filter((r) => !r.blocked)
      .map((r) => r.record)
    // No separate "preview" vs "insert" transformation — the exact object the
    // UI shows IS the one the adapter would send.
    expect(previewRecords[0].leads_status).toBe('IN DISCUSSION')
    expect(previewRecords[0].leads_group_status).toBe('FOLLOWUP')
    expect(previewRecords[1].leads_status).toBe('WON')
    expect(previewRecords[1].leads_group_status).toBe('CLOSED')
  })
})
