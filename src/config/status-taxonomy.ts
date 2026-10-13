/**
 * Status taxonomy mappings — separate for each destination.
 *
 * These lookups are deliberately conservative:
 *   - unknown values are preserved verbatim as `original` and the engine
 *     emits a WARNING (not BLOCKED) so a reviewer can decide.
 *   - Won → Won is a HARD mapping: the engine refuses to silently downgrade
 *     a Won lead to another status if required Won fields are missing.
 */

export type DestinationKey = 'sql' | 'cosmos'

export const SQL_STATUS_TAXONOMY: Record<string, string> = {
  HOT: 'ACTIVE_HOT',
  WARM: 'ACTIVE_WARM',
  COLD: 'ACTIVE_COLD',
  NEW: 'NEW',
  CONTACTED: 'CONTACTED',
  QUALIFIED: 'QUALIFIED',
  WON: 'WON',
  DEAL: 'WON',
  LOST: 'LOST',
  DROPPED: 'DROPPED',
  DROP: 'DROPPED',
  CANCELLED: 'DROPPED',
  CANCEL: 'DROPPED',
}

export const COSMOS_STATUS_TAXONOMY: Record<string, string> = {
  HOT: 'hot',
  WARM: 'warm',
  COLD: 'cold',
  NEW: 'new',
  CONTACTED: 'contacted',
  QUALIFIED: 'qualified',
  WON: 'won',
  DEAL: 'won',
  LOST: 'lost',
  DROPPED: 'dropped',
  DROP: 'dropped',
  CANCELLED: 'dropped',
  CANCEL: 'dropped',
}

export const WON_STATUSES = new Set(['won'])
export const DROPPED_STATUSES = new Set(['dropped', 'lost'])

export function mapStatus(
  destination: DestinationKey,
  raw: unknown,
): { normalized: string; original: string | null; known: boolean } {
  if (raw === null || raw === undefined) {
    return { normalized: '', original: null, known: false }
  }
  const original = String(raw).trim()
  if (original === '') {
    return { normalized: '', original: null, known: false }
  }
  const taxonomy =
    destination === 'sql' ? SQL_STATUS_TAXONOMY : COSMOS_STATUS_TAXONOMY
  const key = original.toUpperCase()
  const mapped = taxonomy[key]
  if (mapped) return { normalized: mapped, original, known: true }
  return { normalized: original, original, known: false }
}

export const KNOWN_SOURCE_TAXONOMY: Record<string, string> = {
  DIGITAL: 'digital',
  ONLINE: 'digital',
  OFFLINE: 'offline',
  REFERRAL: 'referral',
  PAMERAN: 'offline',
  WALKIN: 'offline',
  'WALK-IN': 'offline',
  SOCMED: 'digital',
  'SOCIAL MEDIA': 'digital',
}

export function mapSource(raw: unknown): {
  normalized: string
  original: string | null
  known: boolean
} {
  if (raw === null || raw === undefined) {
    return { normalized: '', original: null, known: false }
  }
  const original = String(raw).trim()
  if (!original) return { normalized: '', original: null, known: false }
  const mapped = KNOWN_SOURCE_TAXONOMY[original.toUpperCase()]
  if (mapped) return { normalized: mapped, original, known: true }
  return { normalized: original.toLowerCase(), original, known: false }
}
