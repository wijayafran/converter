import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Props {
  rows: Array<Record<string, unknown>>
  statement: string
  tableName: string
  limit?: number
}

export function SqlPreview({ rows, statement, tableName, limit = 10 }: Props) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []
  const preview = rows.slice(0, limit)
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="section-heading mb-2">Target table</p>
        <code className="rounded border border-border bg-muted/40 px-2 py-1 font-mono text-xs">
          {tableName}
        </code>
      </div>

      <div>
        <p className="section-heading mb-2">Field preview</p>
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
              {preview.map((row, idx) => (
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
            </TableBody>
          </Table>
        </div>
        {rows.length > preview.length && (
          <p className="mt-2 text-xs text-muted-foreground">
            Menampilkan {preview.length} dari {rows.length.toLocaleString('id-ID')} baris.
          </p>
        )}
      </div>

      <div>
        <p className="section-heading mb-2">INSERT statement preview</p>
        <pre className="scrollbar-slim max-h-80 overflow-auto rounded-lg border border-border bg-muted/30 p-4 text-xs leading-relaxed">
          <code className="font-mono">{statement}</code>
        </pre>
      </div>
    </div>
  )
}

function renderCell(v: unknown) {
  if (v === null || v === undefined)
    return <span className="text-muted-foreground">NULL</span>
  if (typeof v === 'boolean') return v ? '1' : '0'
  return String(v)
}
