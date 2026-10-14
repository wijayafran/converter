/**
 * Status + source taxonomy for the Qonex → CXLite / SQL migration.
 *
 * The single source of truth is `resolveQonexStatus()` (SQL side) and
 * `cosmosStatus()` (Cosmos side). Previous rounds split SQL into separate
 * `sqlStatusUpper()` and `sqlGroupStatus()` calls — that split let the
 * group classifier see "SEND BROCHURE" (raw-upper) while the status field
 * stored the same raw-upper string, so UAT rows surfaced UNKNOWN groups.
 * The shared pipeline below closes that bug: one call returns the
 * destination-specific canonical status, its UPPER form, and the FSM group,
 * all derived from the same lookup.
 *
 *   raw Qonex status → canonical SQL/Lemon status → UPPER canonical
 *                   ↓
 *                 FSM group  (NEW / FOLLOWUP / CLOSED / PENDING / UNKNOWN)
 *
 * Rules of this file:
 *   - Values confirmed in UAT appear in SQL_STATUS_RESOLUTIONS.
 *   - Values whose canonical label is confirmed but whose FSM group is
 *     awaiting stakeholder confirmation go to SQL_STATUS_PENDING.
 *   - Nothing is silently coerced to UNKNOWN. Unknown statuses propagate
 *     with `group: 'UNKNOWN'` so the generator can BLOCK them.
 *   - Cosmos mapping stays independent (see `cosmosStatus` below).
 */

export type DestinationKey = 'sql' | 'cosmos'

export type SqlStatusGroup =
  | 'NEW'
  | 'FOLLOWUP'
  | 'CLOSED'
  /** Canonical confirmed, FSM group awaiting stakeholder confirmation. */
  | 'PENDING'
  /** No canonical mapping found for this raw value. */
  | 'UNKNOWN'

export interface SqlStatusResolution {
  /** The original Qonex string, trimmed; null when the source is blank. */
  rawOriginal: string | null
  /** Destination-specific canonical (Title Case), or null when unresolved. */
  canonical: string | null
  /** UPPER(canonical) — this is what `leads_status` stores. */
  upper: string | null
  /** FSM group for `leads_group_status`. */
  group: SqlStatusGroup
  /** True when the raw value hit a confirmed row in SQL_STATUS_RESOLUTIONS. */
  known: boolean
  /** True when the raw value hit SQL_STATUS_PENDING (canonical ok, group not). */
  pending: boolean
  /** Human-readable context when pending/unknown. */
  reason?: string
}

/**
 * Confirmed Qonex-raw → SQL canonical mappings. Keys are UPPER(raw).
 *
 *   Sources: UAT 2026-10-13 + prior migration spec.
 */
const SQL_STATUS_RESOLUTIONS: Record<
  string,
  { canonical: string; group: Exclude<SqlStatusGroup, 'PENDING' | 'UNKNOWN'> }
> = {
  // Existing Qonex vocabulary
  NEW: { canonical: 'New', group: 'NEW' },
  PRELEAD: { canonical: 'New', group: 'NEW' },
  PRELEADS: { canonical: 'New', group: 'NEW' },
  HOT: { canonical: 'Contacted', group: 'FOLLOWUP' },
  WARM: { canonical: 'Contacted', group: 'FOLLOWUP' },
  COLD: { canonical: 'New', group: 'NEW' },
  CONTACTED: { canonical: 'Contacted', group: 'FOLLOWUP' },
  'IN DISCUSSION': { canonical: 'In Discussion', group: 'FOLLOWUP' },
  'SITE VISIT': { canonical: 'Site Visit', group: 'FOLLOWUP' },
  QUALIFIED: { canonical: 'In Discussion', group: 'FOLLOWUP' },
  WON: { canonical: 'Won', group: 'CLOSED' },
  DEAL: { canonical: 'Won', group: 'CLOSED' },
  LOST: { canonical: 'Dropped', group: 'CLOSED' },
  DROPPED: { canonical: 'Dropped', group: 'CLOSED' },
  DROP: { canonical: 'Dropped', group: 'CLOSED' },
  CANCELLED: { canonical: 'Cancelled', group: 'CLOSED' },
  CANCEL: { canonical: 'Cancelled', group: 'CLOSED' },

  // UAT 2026-10-13 confirmed mappings
  'SEND BROCHURE': { canonical: 'In Discussion', group: 'FOLLOWUP' },
  'NEGOTIATION PROCESS': { canonical: 'In Discussion', group: 'FOLLOWUP' },
  'SCHEDULE SITE VISIT': { canonical: 'Site Visit', group: 'FOLLOWUP' },
  'SEND PRICE SIMULATION': { canonical: 'In Discussion', group: 'FOLLOWUP' },
  'SITE VISIT WITH CLIENT': { canonical: 'Site Visit', group: 'FOLLOWUP' },
  'BOOKING FEE RECEIVED': { canonical: 'Won', group: 'CLOSED' },
  'DROP/LOST OPPORTUNITY': { canonical: 'Cancelled', group: 'CLOSED' },
  // Spelling variants accepted by the UAT reviewer
  'DROP LOST OPPORTUNITY': { canonical: 'Cancelled', group: 'CLOSED' },
  'DROP / LOST OPPORTUNITY': { canonical: 'Cancelled', group: 'CLOSED' },
}

/**
 * Canonical confirmed, FSM group explicitly PENDING stakeholder sign-off.
 * Rows that fall here are flagged with a non-overridable migration issue;
 * canonical is preserved verbatim and NEVER silently rewritten.
 */
const SQL_STATUS_PENDING: Record<
  string,
  { canonical: string; reason: string }
> = {
  'SEND PRICELIST': {
    canonical: 'Discussion',
    reason:
      'FSM group pending: canonical "Discussion" is preserved explicitly and is NOT rewritten to "In Discussion" until Ecovia confirms the FSM group.',
  },
  'FOLLOW UP LEADS': {
    canonical: 'Follow Up Leads',
    reason:
      'Canonical CXLite status and FSM group both pending stakeholder confirmation; raw value preserved for review.',
  },
}

export function resolveQonexStatus(raw: unknown): SqlStatusResolution {
  if (raw === null || raw === undefined) {
    return {
      rawOriginal: null,
      canonical: null,
      upper: null,
      group: 'UNKNOWN',
      known: false,
      pending: false,
      reason: 'empty source status',
    }
  }
  const trimmed = String(raw).trim()
  if (!trimmed) {
    return {
      rawOriginal: null,
      canonical: null,
      upper: null,
      group: 'UNKNOWN',
      known: false,
      pending: false,
      reason: 'blank source status',
    }
  }
  const key = trimmed.toUpperCase()
  const resolved = SQL_STATUS_RESOLUTIONS[key]
  if (resolved) {
    return {
      rawOriginal: trimmed,
      canonical: resolved.canonical,
      upper: resolved.canonical.toUpperCase(),
      group: resolved.group,
      known: true,
      pending: false,
    }
  }
  const pending = SQL_STATUS_PENDING[key]
  if (pending) {
    return {
      rawOriginal: trimmed,
      canonical: pending.canonical,
      upper: pending.canonical.toUpperCase(),
      group: 'PENDING',
      known: true,
      pending: true,
      reason: pending.reason,
    }
  }
  return {
    rawOriginal: trimmed,
    canonical: null,
    upper: null,
    group: 'UNKNOWN',
    known: false,
    pending: false,
    reason: `No canonical mapping for Qonex status "${trimmed}"`,
  }
}

/**
 * Backwards-compatible shims. Older callers (tests, legacy code paths)
 * invoked these two helpers independently; now they both route through
 * the shared pipeline so there is no way to produce drift between
 * `leads_status` and `leads_group_status`.
 */
export function sqlStatusUpper(raw: unknown): string | null {
  return resolveQonexStatus(raw).upper
}

export function sqlGroupStatus(raw: unknown): SqlStatusGroup {
  return resolveQonexStatus(raw).group
}

/**
 * Cosmos mapping — unchanged, Cosmos-specific vocabulary (Title Case).
 */
const COSMOS_STATUS_TABLE: Record<string, string> = {
  HOT: 'Contacted',
  WARM: 'Contacted',
  COLD: 'New',
  NEW: 'New',
  PRELEAD: 'New',
  PRELEADS: 'New',
  CONTACTED: 'Contacted',
  'IN DISCUSSION': 'In Discussion',
  'SITE VISIT': 'Site Visit',
  QUALIFIED: 'In Discussion',
  WON: 'Won',
  DEAL: 'Won',
  LOST: 'Dropped',
  DROPPED: 'Dropped',
  DROP: 'Dropped',
  CANCELLED: 'Cancelled',
  CANCEL: 'Cancelled',
}

export function cosmosStatus(raw: unknown): {
  normalized: string
  original: string | null
  known: boolean
} {
  if (raw === null || raw === undefined) {
    return { normalized: '', original: null, known: false }
  }
  const original = String(raw).trim()
  if (!original) return { normalized: '', original: null, known: false }
  const key = original.toUpperCase()
  const mapped = COSMOS_STATUS_TABLE[key]
  if (mapped) return { normalized: mapped, original, known: true }
  return { normalized: original, original, known: false }
}

export const WON_STATUSES = new Set(['Won'])
export const DROPPED_STATUSES = new Set(['Dropped', 'Cancelled'])

/**
 * CXLite `source` taxonomy (per buat-ricad §4.2).
 */
export const CXLITE_SOURCES_ONLINE = [
  'Ads',
  'IG Ads',
  'Organic',
  'Official Website',
  'Facebook Lead Ads',
  'Whatsapp',
  'Digital Promo',
  'E-Catalog',
] as const

export const CXLITE_SOURCES_OFFLINE = [
  'Walk-in Office',
  'Walk-in',
  'Appointment',
  'Country Club Booth',
  'Exhibition',
  'Personal Database',
  'Offline Event',
  'Referral',
  'Partnership',
] as const

const CXLITE_APPROVED_SOURCES = new Set<string>([
  ...CXLITE_SOURCES_ONLINE,
  ...CXLITE_SOURCES_OFFLINE,
])

/**
 * Confirmed Qonex-raw source → CXLite approved canonical.
 * Keys are UPPER(raw).
 */
const SOURCE_APPROVED_LOOKUP: Record<string, string> = {
  ADS: 'Ads',
  'IG ADS': 'IG Ads',
  INSTAGRAM: 'IG Ads',
  'INSTAGRAM ADS': 'IG Ads',
  ORGANIC: 'Organic',
  WEBSITE: 'Official Website',
  'OFFICIAL WEBSITE': 'Official Website',
  FACEBOOK: 'Facebook Lead Ads',
  'FACEBOOK LEAD ADS': 'Facebook Lead Ads',
  WHATSAPP: 'Whatsapp',
  'DIGITAL PROMO': 'Digital Promo',
  'E-CATALOG': 'E-Catalog',
  WALKIN: 'Walk-in',
  'WALK-IN': 'Walk-in',
  'WALK-IN OFFICE': 'Walk-in Office',
  APPOINTMENT: 'Appointment',
  'COUNTRY CLUB BOOTH': 'Country Club Booth',
  EXHIBITION: 'Exhibition',
  PAMERAN: 'Exhibition',
  'PERSONAL DATABASE': 'Personal Database',
  'OFFLINE EVENT': 'Offline Event',
  REFERRAL: 'Referral',
  REFERRALS: 'Referral',
  TEMAN: 'Referral',
  PARTNERSHIP: 'Partnership',
  DIGITAL: 'Ads',
  OFFLINE: 'Walk-in',
}

/**
 * Qonex-known raw source values whose CXLite canonical is a proposal
 * awaiting Ecovia approval. These must surface as explicit
 * "pending-source-mapping" issues — a "Done" marker in a Value Mapping
 * sheet is NOT the same as an approved canonical.
 */
const SOURCE_PENDING_LOOKUP: Record<
  string,
  { proposedCanonical: string; reason: string }
> = {
  RUMAH123: {
    proposedCanonical: 'Partnership',
    reason:
      'Qonex-known source "Rumah123" — proposed CXLite canonical "Partnership" is pending Ecovia approval.',
  },
  'SML WEBSITE': {
    proposedCanonical: 'Official Website',
    reason:
      'Qonex-known source "SML Website" — proposed CXLite canonical "Official Website" is pending Ecovia approval.',
  },
  'OFFICIAL - FB IG ADS FORM': {
    proposedCanonical: 'Facebook Lead Ads',
    reason:
      'Qonex-known source "Official - FB IG Ads Form" — proposed CXLite canonical "Facebook Lead Ads" is pending Ecovia approval.',
  },
  'OFFICIAL FB IG ADS FORM': {
    proposedCanonical: 'Facebook Lead Ads',
    reason:
      'Qonex-known source variant — proposed CXLite canonical "Facebook Lead Ads" is pending Ecovia approval.',
  },
  'WEBSITE ECOVIA': {
    proposedCanonical: 'Official Website',
    reason:
      'Qonex-known source "Website Ecovia" — proposed CXLite canonical "Official Website" is pending Ecovia approval.',
  },
}

export interface QonexSourceResolution {
  rawOriginal: string | null
  /**
   * Value to WRITE to `leads_source`. Phase 2C invariant:
   *   - cxliteApproved: canonical approved CXLite value
   *   - pending      : the raw Qonex string, unchanged (NOT the proposal)
   *   - unknown      : the raw Qonex string, unchanged
   *
   * Proposed-but-unapproved canonicals never leak into the SQL column —
   * they are surfaced on `proposedCanonical` for the issue report only.
   */
  canonical: string | null
  /**
   * Metadata only. Non-null when a proposal exists but has not been
   * approved by Ecovia. The engine renders this on the issue's
   * `proposedValue` so the reviewer sees the suggestion without the
   * suggestion ever reaching the SQL output.
   */
  proposedCanonical: string | null
  /** Qonex-side vocabulary status: true if we have ever seen this raw value. */
  qonexKnown: boolean
  /** True when the canonical is in the approved CXLite enum (per buat-ricad §4.2). */
  cxliteApproved: boolean
  /** True when `proposedCanonical` is a proposal awaiting Ecovia approval. */
  pending: boolean
  reason?: string
}

export function resolveQonexSource(raw: unknown): QonexSourceResolution {
  if (raw === null || raw === undefined) {
    return {
      rawOriginal: null,
      canonical: null,
      proposedCanonical: null,
      qonexKnown: false,
      cxliteApproved: false,
      pending: false,
    }
  }
  const trimmed = String(raw).trim()
  if (!trimmed) {
    return {
      rawOriginal: null,
      canonical: null,
      proposedCanonical: null,
      qonexKnown: false,
      cxliteApproved: false,
      pending: false,
    }
  }
  const key = trimmed.toUpperCase()
  const approved = SOURCE_APPROVED_LOOKUP[key]
  if (approved) {
    return {
      rawOriginal: trimmed,
      canonical: approved,
      proposedCanonical: null,
      qonexKnown: true,
      cxliteApproved: CXLITE_APPROVED_SOURCES.has(approved),
      pending: false,
    }
  }
  const pending = SOURCE_PENDING_LOOKUP[key]
  if (pending) {
    // Phase 2C: preserve the raw string in the output; the proposal is
    // reported but NEVER silently written to leads_source.
    return {
      rawOriginal: trimmed,
      canonical: trimmed,
      proposedCanonical: pending.proposedCanonical,
      qonexKnown: true,
      cxliteApproved: false,
      pending: true,
      reason: pending.reason,
    }
  }
  // Not in the Qonex vocabulary and not in the CXLite enum: preserve the
  // free-text verbatim so analytics still sees what the operator saw.
  return {
    rawOriginal: trimmed,
    canonical: trimmed,
    proposedCanonical: null,
    qonexKnown: false,
    cxliteApproved: CXLITE_APPROVED_SOURCES.has(trimmed),
    pending: false,
    reason: `Unknown Qonex source "${trimmed}" — not in Qonex vocabulary and not an approved CXLite value.`,
  }
}

export function cxliteSource(raw: unknown): {
  normalized: string
  original: string | null
  known: boolean
} {
  const r = resolveQonexSource(raw)
  return {
    normalized: r.canonical ?? '',
    original: r.rawOriginal,
    known: r.cxliteApproved,
  }
}

/**
 * Legacy alias kept for tests that imported `mapStatus` / `mapSource`.
 */
export function mapStatus(dest: DestinationKey, raw: unknown) {
  if (dest === 'sql') {
    const r = resolveQonexStatus(raw)
    return {
      normalized: r.canonical ?? '',
      original: r.rawOriginal,
      known: r.known && !r.pending,
    }
  }
  return cosmosStatus(raw)
}

export function mapSource(raw: unknown) {
  return cxliteSource(raw)
}
