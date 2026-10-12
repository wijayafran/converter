import { FileSpreadsheet } from 'lucide-react'
import type { ParsedFile } from '@/types'
import { formatBytes } from '@/lib/excel'

interface Props {
  file: ParsedFile
}

export function FileSummary({ file }: Props) {
  const items: Array<[string, string]> = [
    ['Nama file', file.fileName],
    ['Ukuran', formatBytes(file.fileSize)],
    ['Sheet', file.sheetName],
    ['Jumlah baris', file.rowCount.toLocaleString('id-ID')],
    ['Jumlah kolom', String(file.columnCount)],
  ]
  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <div className="rounded-md border border-border bg-muted/40 p-2">
          <FileSpreadsheet className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-medium">File information</p>
          <p className="text-xs text-muted-foreground">
            Dibaca secara lokal di browser.
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-5 sm:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              {label}
            </dt>
            <dd className="mt-1 truncate text-sm font-medium" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-border px-5 py-3">
        <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
          Header preview
        </p>
        <div className="flex flex-wrap gap-1.5">
          {file.headers.slice(0, 20).map((h) => (
            <span
              key={h}
              className="rounded border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs"
            >
              {h}
            </span>
          ))}
          {file.headers.length > 20 && (
            <span className="rounded border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
              +{file.headers.length - 20} lainnya
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
