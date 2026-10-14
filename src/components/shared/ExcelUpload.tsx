import { useRef, useState } from 'react'
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { parseExcelFile } from '@/lib/excel'
import type { ParsedFile } from '@/types'
import { SAMPLE_PARSED_FILE } from '@/mocks/sample-rows'
import { cn } from '@/lib/cn'

interface Props {
  onParsed: (file: ParsedFile) => void
}

export function ExcelUpload({ onParsed }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setLoading(true)
    try {
      const parsed = await parseExcelFile(file)
      if (parsed.rowCount === 0) {
        throw new Error('File tidak berisi data (0 baris).')
      }
      onParsed(parsed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membaca file.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragActive(false)
          const f = e.dataTransfer.files[0]
          if (f) handleFile(f)
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors',
          dragActive
            ? 'border-primary bg-muted/40'
            : 'border-border bg-muted/20 hover:border-primary/60 hover:bg-muted/30',
        )}
      >
        <div className="rounded-full border border-border bg-background p-3">
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <Upload className="h-6 w-6" />
          )}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {loading ? 'Membaca file Excel…' : 'Tarik file atau klik untuk unggah'}
          </p>
          <p className="text-xs text-muted-foreground">
            Format yang didukung: .xlsx, .xls, .csv — dibaca di browser,
            hanya hasil transformasi yang dikirim ke backend lokal saat SQL
            Local Test diaktifkan.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
          }}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          atau
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <Button
        variant="outline"
        onClick={() => onParsed(SAMPLE_PARSED_FILE)}
        className="w-full justify-center"
        type="button"
      >
        <FileSpreadsheet className="h-4 w-4" />
        Gunakan data contoh (3 baris, 32 kolom)
      </Button>
    </div>
  )
}
