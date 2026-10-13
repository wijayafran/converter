import { describe, expect, it } from 'vitest'
import { canOverride, runValidation } from '@/lib/validation'
import { buildParsedFile, validRow, wonRow } from './fixtures'

describe('validation engine', () => {
  it('unknown status is a WARNING on SQL (preserved as UNKNOWN group)', () => {
    const parsed = buildParsedFile([validRow({ status: 'MAYBE' })])
    const result = runValidation({ destination: 'sql', parsed })
    const unknown = result.issues.find((i) => i.category === 'unknown-status')
    expect(unknown?.severity).toBe('WARNING')
  })

  it('structural warnings cannot be overridden', () => {
    const parsed = buildParsedFile([wonRow({ ktp: '' })])
    const result = runValidation({ destination: 'lemon', parsed })
    const blocked = result.issues.filter((i) => i.severity === 'BLOCKED')
    expect(blocked.length).toBeGreaterThan(0)
    for (const b of blocked) expect(canOverride(b)).toBe(false)
  })

  it('non-structural invalid-phone warning is overridable', () => {
    const parsed = buildParsedFile([validRow({ nomor_telepon: '0899 999 999' })])
    const result = runValidation({ destination: 'sql', parsed })
    const warning = result.issues.find(
      (i) => i.severity === 'WARNING' && i.category === 'invalid-phone',
    )
    expect(warning).toBeDefined()
    expect(canOverride(warning!)).toBe(true)
  })

  it('produces per-row description + recommendation', () => {
    const parsed = buildParsedFile([validRow({ nomor_telepon: '0899 999 999' })])
    const result = runValidation({ destination: 'sql', parsed })
    const warn = result.issues.find((i) => i.severity === 'WARNING')
    expect(warn).toBeDefined()
    expect(warn?.description).toBeTruthy()
    expect(warn?.recommendedAction).toBeTruthy()
  })
})
