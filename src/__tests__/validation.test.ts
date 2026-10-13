import { describe, expect, it } from 'vitest'
import { canOverride, runValidation } from '@/lib/validation'
import { buildParsedFile, validRow, wonRow } from './fixtures'

describe('validation engine', () => {
  it('runs real rules — status unknown is a warning', () => {
    const parsed = buildParsedFile([validRow({ status: 'MAYBE' })])
    const result = runValidation({ destination: 'sql', parsed })
    const unknown = result.issues.find(
      (i) => i.category === 'unknown-status',
    )
    expect(unknown?.severity).toBe('WARNING')
  })

  it('structural warnings cannot be overridden', () => {
    const parsed = buildParsedFile([wonRow({ ktp: '' })])
    const result = runValidation({ destination: 'lemon', parsed })
    const blocked = result.issues.filter((i) => i.severity === 'BLOCKED')
    expect(blocked.length).toBeGreaterThan(0)
    for (const b of blocked) expect(canOverride(b)).toBe(false)
  })

  it('non-structural warnings are overridable (invalid phone shape, precision)', () => {
    const parsed = buildParsedFile([
      validRow({ nomor_telepon: '0899 999 999' }), // short → warning
    ])
    const result = runValidation({ destination: 'sql', parsed })
    const warning = result.issues.find(
      (i) => i.severity === 'WARNING' && i.category === 'invalid-phone',
    )
    expect(warning).toBeDefined()
    expect(canOverride(warning!)).toBe(true)
  })

  it('produces per-row explanation including original + proposed', () => {
    const parsed = buildParsedFile([
      validRow({ email: 'DEWI@Example.COM', lat: -6.9039183 }),
    ])
    const result = runValidation({ destination: 'sql', parsed })
    const precision = result.issues.find((i) => i.category === 'precision-loss')
    expect(precision).toBeDefined()
    expect(precision?.description).toBeTruthy()
    expect(precision?.recommendedAction).toBeTruthy()
  })
})
