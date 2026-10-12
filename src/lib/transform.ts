import type { FieldMapping, ParsedFile } from '@/types'
import { LEMON_FIELD_MAPPINGS } from '@/config/lemon-mapping'
import { SQL_FIELD_MAPPINGS, SQL_TARGET_TABLE } from '@/config/sql-mapping'

function setDeep(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let node: Record<string, unknown> = target
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    if (typeof node[key] !== 'object' || node[key] === null) {
      node[key] = {}
    }
    node = node[key] as Record<string, unknown>
  }
  node[parts[parts.length - 1]] = value
}

function resolveValue(
  mapping: FieldMapping,
  row: Record<string, unknown>,
  rowIndex: number,
): unknown {
  if (mapping.type === 'Default') {
    if (mapping.destinationField.toLowerCase().includes('source'))
      return 'QONEX'
    return null
  }
  if (mapping.type === 'Generated') {
    return `sim-${String(rowIndex + 1).padStart(6, '0')}`
  }
  if (!mapping.sourceField) return null
  const raw = row[mapping.sourceField]
  if (raw === undefined || raw === null || raw === '') return null
  if (mapping.type === 'Transform') {
    return transformValue(mapping, raw)
  }
  return raw
}

function transformValue(mapping: FieldMapping, raw: unknown): unknown {
  const field = mapping.destinationField.toLowerCase()
  if (field.includes('phone')) {
    const digits = String(raw).replace(/\D/g, '')
    if (digits.startsWith('0')) return `+62${digits.slice(1)}`
    if (digits.startsWith('62')) return `+${digits}`
    return digits ? `+${digits}` : null
  }
  if (field.includes('email')) {
    return String(raw).trim().toLowerCase()
  }
  if (
    field.includes('createdat') ||
    field.includes('updatedat') ||
    field.includes('_at') ||
    field.includes('nextaction') ||
    field.includes('lastvisit') ||
    field.includes('firstcontact')
  ) {
    const date = new Date(String(raw))
    if (!Number.isNaN(date.getTime())) return date.toISOString()
    return String(raw)
  }
  if (
    field.includes('latitude') ||
    field.includes('longitude') ||
    field === 'geo.lat' ||
    field === 'geo.lng'
  ) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return null
    return Math.round(n * 1e6) / 1e6
  }
  if (field.includes('bookmark') || field.includes('bookmarked')) {
    if (typeof raw === 'boolean') return raw
    const s = String(raw).trim().toLowerCase()
    return s === '1' || s === 'true' || s === 'ya' || s === 'yes'
  }
  if (
    field.includes('count') ||
    field.includes('progress') ||
    field.includes('whatsapp') ||
    field.includes('call')
  ) {
    const n = Number(raw)
    return Number.isFinite(n) ? Math.trunc(n) : 0
  }
  return raw
}

export function transformToLemon(parsed: ParsedFile): Array<Record<string, unknown>> {
  return parsed.rows.map((row, i) => {
    const output: Record<string, unknown> = {}
    for (const mapping of LEMON_FIELD_MAPPINGS) {
      if (mapping.type === 'Ignored') continue
      const value = resolveValue(mapping, row, i)
      if (value === null && mapping.requirement === 'optional') continue
      setDeep(output, mapping.destinationPath ?? mapping.destinationField, value)
    }
    return output
  })
}

export function transformToSqlRows(
  parsed: ParsedFile,
): Array<Record<string, unknown>> {
  return parsed.rows.map((row, i) => {
    const output: Record<string, unknown> = {}
    for (const mapping of SQL_FIELD_MAPPINGS) {
      if (mapping.type === 'Ignored') continue
      output[mapping.destinationField] = resolveValue(mapping, row, i)
    }
    return output
  })
}

export function buildSqlPreviewStatement(
  rows: Array<Record<string, unknown>>,
  limit = 2,
): string {
  if (rows.length === 0) return '-- No rows to preview'
  const columns = Object.keys(rows[0])
  const lines: string[] = []
  const sample = rows.slice(0, limit)
  for (const row of sample) {
    const values = columns.map((col) => {
      const v = row[col]
      if (v === null || v === undefined) return 'NULL'
      if (typeof v === 'number') return String(v)
      if (typeof v === 'boolean') return v ? '1' : '0'
      return `N'${String(v).replace(/'/g, "''")}'`
    })
    lines.push(
      `INSERT INTO ${SQL_TARGET_TABLE} (${columns.join(', ')})\n  VALUES (${values.join(', ')});`,
    )
  }
  if (rows.length > limit) {
    lines.push(`-- …plus ${rows.length - limit} more rows (simulated)`)
  }
  return lines.join('\n\n')
}
