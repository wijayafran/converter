import { ExcelUpload } from '@/components/shared/ExcelUpload'
import { FileSummary } from '@/components/shared/FileSummary'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import type { ParsedFile } from '@/types'

interface Props {
  parsedFile: ParsedFile | null
  onParsed: (file: ParsedFile) => void
  onClear: () => void
  destinationLabel: string
}

export function UploadStep({
  parsedFile,
  onParsed,
  onClear,
  destinationLabel,
}: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Alert variant="info">
        <AlertTitle>Privacy by default</AlertTitle>
        <AlertDescription>
          File Excel diproses sepenuhnya di browser Anda. Tidak ada data pelanggan
          yang diunggah ke server pada Phase 1 — ini berlaku untuk migrasi
          {' '}
          <strong>{destinationLabel}</strong>.
        </AlertDescription>
      </Alert>

      {!parsedFile ? (
        <ExcelUpload onParsed={onParsed} />
      ) : (
        <div className="flex flex-col gap-4">
          <FileSummary file={parsedFile} />
          <div>
            <Button variant="ghost" size="sm" onClick={onClear}>
              <Trash2 className="h-3.5 w-3.5" />
              Ganti file
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
