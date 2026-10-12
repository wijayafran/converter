import type { ParsedFile } from '@/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Props {
  file: ParsedFile
  limit?: number
}

export function DataPreview({ file, limit = 10 }: Props) {
  const headers = file.headers
  const rows = file.rows.slice(0, limit)
  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14">#</TableHead>
            {headers.map((h) => (
              <TableHead key={h} className="whitespace-nowrap">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, idx) => (
            <TableRow key={idx}>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {idx + 1}
              </TableCell>
              {headers.map((h) => (
                <TableCell key={h} className="whitespace-nowrap text-xs">
                  {renderCell(row[h])}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={headers.length + 1} className="py-10 text-center text-sm text-muted-foreground">
                Tidak ada data untuk ditampilkan.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {file.rows.length > rows.length && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Menampilkan {rows.length} dari {file.rows.length.toLocaleString('id-ID')} baris.
        </div>
      )}
    </div>
  )
}

function renderCell(v: unknown) {
  if (v === null || v === undefined || v === '')
    return <span className="text-muted-foreground">—</span>
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
