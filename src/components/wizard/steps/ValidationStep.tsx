import { PlayCircle, RefreshCw } from 'lucide-react'
import { ValidationSummary } from '@/components/shared/ValidationSummary'
import { EmptyState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { ValidationIssue } from '@/types'

interface Props {
  totalRecords: number
  issues: ValidationIssue[]
  onRun: () => void
}

export function ValidationStep({ totalRecords, issues, onRun }: Props) {
  const hasRun = issues.length > 0

  return (
    <div className="flex flex-col gap-6">
      <Alert variant="info">
        <AlertTitle>Mock validation engine</AlertTitle>
        <AlertDescription>
          Pada Phase 1, hasil validasi menggunakan dataset ilustratif agar user
          dapat menguji seluruh alur. Pada Phase 2, modul validasi akan
          menjalankan aturan sesungguhnya terhadap setiap baris Excel.
        </AlertDescription>
      </Alert>

      {!hasRun ? (
        <EmptyState
          title="Validasi belum dijalankan"
          description={`Siap untuk memeriksa ${totalRecords.toLocaleString('id-ID')} baris data terhadap aturan dasar.`}
          action={
            <Button onClick={onRun} className="mt-2">
              <PlayCircle className="h-4 w-4" />
              Jalankan validasi
            </Button>
          }
        />
      ) : (
        <>
          <ValidationSummary totalRecords={totalRecords} issues={issues} />
          <div>
            <Button variant="outline" onClick={onRun}>
              <RefreshCw className="h-4 w-4" />
              Jalankan ulang
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
