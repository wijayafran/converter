import * as XLSX from 'xlsx'
import type { ParsedFile } from '@/types'

export async function parseExcelFile(file: File): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error('File tidak memiliki sheet apa pun.')
  }
  const worksheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
    raw: false,
  })
  const headers =
    rows.length > 0
      ? Object.keys(rows[0])
      : (XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1 })[0] ?? [])
  return {
    fileName: file.name,
    fileSize: file.size,
    sheetName,
    rowCount: rows.length,
    columnCount: headers.length,
    headers,
    rows,
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
