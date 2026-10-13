/**
 * Deterministic, side-effect-free value normalizers shared by both the
 * SQL Server and Cosmos (LEMONS) transformation pipelines.
 *
 * Every helper is a pure function; all inputs are treated as untrusted (the
 * raw cell values coming out of xlsx), every output is either a well-formed
 * primitive or `null`, and nothing throws on bad input — callers rely on
 * `null` / `undefined` as the "no value" signal so downstream validation can
 * fire a BLOCKED/WARNING issue instead of crashing the transform.
 */

export interface PhoneResult {
  normalized: string | null
  digits: string
  valid: boolean
  reason?: string
}

const JAKARTA_OFFSET_MIN = 7 * 60

export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (value instanceof Date) return Number.isNaN(value.getTime())
  return false
}

export function trimString(value: unknown): string | null {
  if (isBlank(value)) return null
  const s = typeof value === 'string' ? value : String(value)
  const trimmed = s.trim()
  return trimmed === '' ? null : trimmed
}

export function normalizeEmail(value: unknown): string | null {
  const s = trimString(value)
  if (!s) return null
  return s.toLowerCase()
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/**
 * Indonesian phone normalization → E.164 (+62…).
 * Accepts: "0812…", "+62812…", "62812…", "812…", with spaces / dashes / parens.
 * Rejects non-ID numbers (we flag rather than coerce to avoid data loss).
 */
export function normalizePhone(value: unknown): PhoneResult {
  if (isBlank(value)) {
    return { normalized: null, digits: '', valid: false, reason: 'empty' }
  }
  const raw = typeof value === 'string' ? value : String(value)
  const digits = raw.replace(/\D/g, '')
  if (digits === '') {
    return { normalized: null, digits: '', valid: false, reason: 'no-digits' }
  }
  let core: string
  if (digits.startsWith('62')) core = digits.slice(2)
  else if (digits.startsWith('0')) core = digits.slice(1)
  else core = digits

  if (core.length < 10 || core.length > 13) {
    return {
      normalized: `+62${core}`,
      digits: core,
      valid: false,
      reason: `length-${core.length}`,
    }
  }
  if (!core.startsWith('8')) {
    return {
      normalized: `+62${core}`,
      digits: core,
      valid: false,
      reason: 'not-mobile',
    }
  }
  return {
    normalized: `+62${core}`,
    digits: core,
    valid: true,
  }
}

/**
 * Build the WA_MOBILE identifier (configurable prefix, lower-case).
 * Produces `wa_628…` from a validated phone. If phone is invalid returns null.
 */
export function waMobileId(
  phone: PhoneResult,
  prefix = 'wa_',
): string | null {
  if (!phone.valid || !phone.normalized) return null
  return `${prefix}${phone.normalized.replace(/^\+/, '')}`
}

/** Preserve null/blank — never coerce to 0 */
export function toInteger(value: unknown): number | null {
  if (isBlank(value)) return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

export function toDecimal(
  value: unknown,
  precision = 6,
): { value: number | null; precisionLoss: boolean } {
  if (isBlank(value)) return { value: null, precisionLoss: false }
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n)) return { value: null, precisionLoss: false }
  const factor = 10 ** precision
  const rounded = Math.round(n * factor) / factor
  const precisionLoss = Math.abs(rounded - n) > Number.EPSILON
  return { value: rounded, precisionLoss }
}

/**
 * Parse a numeric that is sometimes stored as a decorated string
 * ("Rp 2.500.000", "1.5M", "> 2M").  Returns the raw bucket string if a
 * number can't be extracted; callers decide if that's acceptable.
 */
export function safeNumericString(value: unknown): {
  raw: string | null
  numeric: number | null
} {
  const raw = trimString(value)
  if (!raw) return { raw: null, numeric: null }
  let cleaned = raw.replace(/[^0-9.,-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === ',') {
    return { raw, numeric: null }
  }
  // Indonesian locale: '.' is a thousands separator, ',' is the decimal mark.
  // When both are present, '.' is thousands, ',' is decimal. When only '.'
  // appears with a group of 3 following it (and more than one dot or a
  // non-decimal grouping), treat all dots as thousands.
  if (cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  } else {
    const dots = cleaned.split('.')
    if (dots.length > 2 || (dots.length === 2 && dots[1].length === 3)) {
      cleaned = dots.join('')
    }
  }
  const n = Number(cleaned)
  return { raw, numeric: Number.isFinite(n) ? n : null }
}

export function toBoolean(value: unknown): boolean | null {
  if (isBlank(value)) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const s = String(value).trim().toLowerCase()
  if (['1', 'true', 't', 'yes', 'y', 'ya'].includes(s)) return true
  if (['0', 'false', 'f', 'no', 'n', 'tidak'].includes(s)) return false
  return null
}

export interface DateResult {
  iso: string | null
  jakartaIso: string | null
  utcIso: string | null
  valid: boolean
  reason?: string
}

/**
 * Parse arbitrary date-ish input into both UTC and WIB (UTC+7, Jakarta).
 * - Accepts Date objects (xlsx with cellDates: true), Excel serial numbers,
 *   and ISO-like strings with or without timezone.
 * - A date WITHOUT a timezone marker is assumed to be local Jakarta time.
 * - Return value `.utcIso` is always UTC; `.jakartaIso` is the equivalent
 *   wall-clock in WIB with the +07:00 offset.
 */
export function parseDate(value: unknown): DateResult {
  if (isBlank(value)) {
    return { iso: null, jakartaIso: null, utcIso: null, valid: false, reason: 'empty' }
  }

  let dt: Date | null = null

  if (value instanceof Date) {
    dt = Number.isNaN(value.getTime()) ? null : value
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    dt = excelSerialToDate(value)
  } else {
    const s = String(value).trim()
    const hasTz = /Z|[+-]\d{2}:?\d{2}$/.test(s)
    if (hasTz) {
      const d = new Date(s)
      dt = Number.isNaN(d.getTime()) ? null : d
    } else {
      dt = parseLocalDateAssumingJakarta(s)
    }
  }

  if (!dt) {
    return {
      iso: null,
      jakartaIso: null,
      utcIso: null,
      valid: false,
      reason: 'unparseable',
    }
  }

  const utcIso = dt.toISOString()
  const jakartaIso = formatInOffset(dt, JAKARTA_OFFSET_MIN)
  return {
    iso: utcIso,
    jakartaIso,
    utcIso,
    valid: true,
  }
}

function excelSerialToDate(serial: number): Date | null {
  if (serial <= 0) return null
  const utcDays = serial - 25569
  const utcMs = utcDays * 86400 * 1000
  const dt = new Date(utcMs)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function parseLocalDateAssumingJakarta(s: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    return fromJakartaWallClock(+y, +m, +d, 0, 0, 0)
  }
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(
    s,
  )
  if (dmy) {
    const [, d, m, y, hh = '0', mm = '0', ss = '0'] = dmy
    return fromJakartaWallClock(+y, +m, +d, +hh, +mm, +ss)
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(
    s,
  )
  if (iso) {
    const [, y, m, d, hh, mm, ss = '0'] = iso
    return fromJakartaWallClock(+y, +m, +d, +hh, +mm, +ss)
  }
  const fallback = new Date(s)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

function fromJakartaWallClock(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  ss: number,
): Date {
  const utcMs = Date.UTC(y, m - 1, d, hh, mm, ss) - JAKARTA_OFFSET_MIN * 60_000
  return new Date(utcMs)
}

function formatInOffset(dt: Date, offsetMinutes: number): string {
  const shifted = new Date(dt.getTime() + offsetMinutes * 60_000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absM = Math.abs(offsetMinutes)
  const offH = pad(Math.floor(absM / 60))
  const offMin = pad(absM % 60)
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
      shifted.getUTCDate(),
    )}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(
      shifted.getUTCSeconds(),
    )}${sign}${offH}:${offMin}`
  )
}

export function clampVarchar(
  value: unknown,
  maxLength: number,
): { value: string | null; truncated: boolean } {
  const s = trimString(value)
  if (!s) return { value: null, truncated: false }
  if (s.length <= maxLength) return { value: s, truncated: false }
  return { value: s.slice(0, maxLength), truncated: true }
}
