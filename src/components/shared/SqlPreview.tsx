import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type PageSize = 10 | 25 | 50 | 'all'

interface Props {
  rows: Array<Record<string, unknown>>
  statement: string
  tableName: string
}

export function SqlPreview({ rows, statement, tableName }: Props) {
  const [pageSize, setPageSize] = useState<PageSize>(10)
  const [page, setPage] = useState(1)

  const total = rows.length
  const effectiveSize = pageSize === 'all' ? Math.max(total, 1) : pageSize
  const pageCount = Math.max(1, Math.ceil(total / effectiveSize))
  // Clamp page in case total shrank below current index.
  const safePage = Math.min(Math.max(1, page), pageCount)
  const start = total === 0 ? 0 : (safePage - 1) * effectiveSize
  const end = Math.min(start + effectiveSize, total)
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []
  const pageRows = useMemo(() => rows.slice(start, end), [rows, start, end])

  const counterLabel =
    total === 0
      ? 'No eligible records'
      : `Showing ${start + 1}–${end} of ${total.toLocaleString('id-ID')} records`

  function changePageSize(next: PageSize) {
    setPageSize(next)
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="section-heading mb-2">Target table</p>
        <code className="rounded border border-border bg-muted/40 px-2 py-1 font-mono text-xs">
          {tableName}
        </code>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <p className="section-heading">Field preview</p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>Rows per page:</span>
            <div className="flex gap-1">
              {([10, 25, 50, 'all'] as const).map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => changePageSize(size)}
                  className="focus:outline-none"
                >
                  <Badge
                    variant={pageSize === size ? 'default' : 'outline'}
                    className="cursor-pointer uppercase"
                  >
                    {size === 'all' ? 'All' : size}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border">
          <div className="scrollbar-slim overflow-auto">
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
                {pageRows.map((row, idx) => (
                  <TableRow key={start + idx}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {start + idx + 1}
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
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            {counterLabel}
            {total > 0 && (
              <span className="ml-2 text-[11px]">
                (preview display only — JSON download and SQL batch always
                include all eligible records)
              </span>
            )}
          </span>
          {pageCount > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </Button>
              <span className="font-mono text-[11px]">
                Page {safePage} / {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
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
