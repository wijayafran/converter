import { describe, expect, it } from 'vitest'
import {
  clampVarchar,
  isValidEmail,
  normalizeEmail,
  normalizePhone,
  parseDate,
  safeNumericString,
  toBoolean,
  toDecimal,
  toInteger,
  trimString,
  waMobileId,
} from '@/lib/transform/primitives'

describe('phone normalization', () => {
  it('normalizes Indonesian local 08xx to +628xx', () => {
    const r = normalizePhone('0812-3456-7890')
    expect(r.normalized).toBe('+6281234567890')
    expect(r.valid).toBe(true)
  })

  it('accepts +62 prefix', () => {
    expect(normalizePhone('+62 877 1234 5678').normalized).toBe('+6287712345678')
  })

  it('accepts 62 prefix', () => {
    expect(normalizePhone('6287712345678').normalized).toBe('+6287712345678')
  })

  it('flags too-short numbers as invalid', () => {
    const r = normalizePhone('0899 999 999')
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('length')
  })

  it('rejects non-mobile prefixes', () => {
    const r = normalizePhone('021-5551-2123')
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('not-mobile')
  })

  it('returns empty for null', () => {
    expect(normalizePhone(null).normalized).toBeNull()
  })
})

describe('waMobileId', () => {
  it('builds wa_<digits> from a validated phone', () => {
    const phone = normalizePhone('0812-3456-7890')
    expect(waMobileId(phone)).toBe('wa_6281234567890')
  })
  it('is null for invalid phone', () => {
    expect(waMobileId(normalizePhone('bad'))).toBeNull()
  })
})

describe('email', () => {
  it('normalizes case + trims', () => {
    expect(normalizeEmail('  Foo@Bar.COM  ')).toBe('foo@bar.com')
  })
  it('rejects non-email strings', () => {
    expect(isValidEmail('not-an-email')).toBe(false)
    expect(isValidEmail('ok@x.co')).toBe(true)
  })
})

describe('date / timezone', () => {
  it('parses an ISO date without TZ as Jakarta local', () => {
    const r = parseDate('2026-02-01 09:14')
    expect(r.valid).toBe(true)
    expect(r.utcIso).toBe('2026-02-01T02:14:00.000Z')
    expect(r.jakartaIso).toContain('+07:00')
  })

  it('passes through TZ-aware input', () => {
    const r = parseDate('2026-02-01T09:14:00Z')
    expect(r.utcIso).toBe('2026-02-01T09:14:00.000Z')
  })

  it('parses DD/MM/YYYY as Jakarta local', () => {
    const r = parseDate('01/02/2026')
    expect(r.valid).toBe(true)
    expect(r.utcIso).toBe('2026-01-31T17:00:00.000Z')
  })

  it('parses Excel serial numbers', () => {
    const expected = Date.UTC(2026, 1, 1) / 86400000 + 25569
    const r = parseDate(expected)
    expect(r.valid).toBe(true)
    expect(r.utcIso?.startsWith('2026-02-01')).toBe(true)
  })

  it('reports invalid input', () => {
    const r = parseDate('not a date')
    expect(r.valid).toBe(false)
  })

  it('treats blank as invalid', () => {
    expect(parseDate('').valid).toBe(false)
    expect(parseDate(null).valid).toBe(false)
  })
})

describe('numeric helpers', () => {
  it('preserves null for blank integers', () => {
    expect(toInteger('')).toBeNull()
    expect(toInteger(null)).toBeNull()
  })
  it('truncates fractional integers', () => {
    expect(toInteger(3.7)).toBe(3)
  })
  it('rounds decimals and flags precision loss', () => {
    const r = toDecimal(-6.9039183, 6)
    expect(r.value).toBe(-6.903918)
    expect(r.precisionLoss).toBe(true)
  })
  it('safeNumericString extracts a number from "Rp 2.500.000"', () => {
    const r = safeNumericString('Rp 2.500.000')
    expect(r.numeric).toBe(2500000)
    expect(r.raw).toBe('Rp 2.500.000')
  })
})

describe('boolean + trim + clamp', () => {
  it('toBoolean handles ya/tidak', () => {
    expect(toBoolean('ya')).toBe(true)
    expect(toBoolean('tidak')).toBe(false)
    expect(toBoolean('')).toBeNull()
  })
  it('trimString preserves null for blanks', () => {
    expect(trimString('   ')).toBeNull()
    expect(trimString(' hi ')).toBe('hi')
  })
  it('clampVarchar truncates at max length', () => {
    const r = clampVarchar('a'.repeat(10), 5)
    expect(r.value).toBe('aaaaa')
    expect(r.truncated).toBe(true)
  })
})
