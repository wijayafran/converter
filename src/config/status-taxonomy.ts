/**
 * Status taxonomy — authoritative mapping lives here, not in the generators.
 *
 * SQL rule (per analytics-sqlserver-lemons.md §3):
 *   NEW / PRELEADS           → NEW
 *   CONTACTED / IN DISCUSSION / SITE VISIT → FOLLOWUP
 *   WON / DROPPED / CANCELLED → CLOSED
 *   else                      → UNKNOWN
 *
 * Cosmos lead statuses (per buat-ricad §4.1): one of
 *   New, Contacted, In Discussion, Site Visit, Won, Dropped, Cancelled.
 * (The app also writes "Deleted" for soft-deleted leads; migration never
 * emits this.)
 */

export type DestinationKey = 'sql' | 'cosmos'

const SQL_GROUP_NEW = new Set(['NEW', 'PRELEADS'])
const SQL_GROUP_FOLLOWUP = new Set(['CONTACTED', 'IN DISCUSSION', 'SITE VISIT'])
const SQL_GROUP_CLOSED = new Set(['WON', 'DROPPED', 'CANCELLED'])

export function sqlGroupStatus(raw: unknown): string {
  if (raw === null || raw === undefined) return 'UNKNOWN'
  const up = String(raw).trim().toUpperCase()
  if (!up) return 'UNKNOWN'
  if (SQL_GROUP_NEW.has(up)) return 'NEW'
  if (SQL_GROUP_FOLLOWUP.has(up)) return 'FOLLOWUP'
  if (SQL_GROUP_CLOSED.has(up)) return 'CLOSED'
  return 'UNKNOWN'
}

export function sqlStatusUpper(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const trimmed = String(raw).trim()
  return trimmed === '' ? null : trimmed.toUpperCase()
}

/**
 * Normalize Qonex status label → CXLite status label (Title Case).
 * Unknown labels are preserved verbatim and the engine warns.
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
 * CXLite `source` taxonomy (per buat-ricad §4.2). Values are case-sensitive
 * and must match exactly; anything else is kept verbatim and surfaced to the
 * reviewer as "Other".
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

const CXLITE_SOURCE_LOOKUP: Record<string, string> = {
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
  TEMAN: 'Referral',
  PARTNERSHIP: 'Partnership',
  DIGITAL: 'Ads',
  OFFLINE: 'Walk-in',
}

export function cxliteSource(raw: unknown): {
  normalized: string
  original: string | null
  known: boolean
} {
  if (raw === null || raw === undefined) {
    return { normalized: '', original: null, known: false }
  }
  const original = String(raw).trim()
  if (!original) return { normalized: '', original: null, known: false }
  const mapped = CXLITE_SOURCE_LOOKUP[original.toUpperCase()]
  if (mapped) return { normalized: mapped, original, known: true }
  return { normalized: original, original, known: false }
}

/**
 * Legacy alias kept for the Phase 2A tests that import `mapStatus` and
 * `mapSource`. Both are expressed in terms of the authoritative helpers
 * above.
 */
export function mapStatus(dest: DestinationKey, raw: unknown) {
  if (dest === 'sql') {
    const up = sqlStatusUpper(raw)
    return {
      normalized: up ?? '',
      original: up,
      known: up !== null,
    }
  }
  return cosmosStatus(raw)
}

export function mapSource(raw: unknown) {
  return cxliteSource(raw)
}
