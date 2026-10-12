import type { FieldMapping, ValidationIssue } from '@/types'

export interface MappingSummary {
  total: number
  matched: number
  requiredMissing: number
  optionalMissing: number
  extraSource: number
  verified: number
}

export function computeMappingSummary(
  mappings: FieldMapping[],
  availableSourceHeaders: string[],
  extraSource: string[],
): MappingSummary {
  const matched = mappings.filter(
    (m) =>
      (m.sourceField && availableSourceHeaders.includes(m.sourceField)) ||
      m.type === 'Default' ||
      m.type === 'Generated',
  ).length
  const requiredMissing = mappings.filter(
    (m) =>
      m.requirement === 'required' &&
      m.sourceField &&
      !availableSourceHeaders.includes(m.sourceField),
  ).length
  const optionalMissing = mappings.filter(
    (m) =>
      m.requirement === 'optional' &&
      m.sourceField &&
      !availableSourceHeaders.includes(m.sourceField),
  ).length
  const verified = mappings.filter((m) => m.verified).length
  return {
    total: mappings.length,
    matched,
    requiredMissing,
    optionalMissing,
    extraSource: extraSource.length,
    verified,
  }
}

export function findExtraSourceHeaders(
  availableSourceHeaders: string[],
  mappings: FieldMapping[],
  knownSourceFields: readonly string[],
): string[] {
  const mapped = new Set(
    mappings
      .map((m) => m.sourceField)
      .filter((v): v is string => typeof v === 'string'),
  )
  return availableSourceHeaders.filter(
    (h) => !mapped.has(h) && !knownSourceFields.includes(h),
  )
}

export function canProceedPastValidation(issues: ValidationIssue[]): boolean {
  return !issues.some(
    (i) => i.severity === 'BLOCKED' && i.decision !== 'exclude',
  )
}
