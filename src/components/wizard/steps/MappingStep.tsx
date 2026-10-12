import { useMemo } from 'react'
import { MappingSummaryCards } from '@/components/shared/MappingSummaryCards'
import { MappingTable } from '@/components/shared/MappingTable'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { QONEX_SOURCE_FIELDS } from '@/config/qonex-source'
import {
  computeMappingSummary,
  findExtraSourceHeaders,
} from '@/lib/mapping'
import type { FieldMapping, ParsedFile } from '@/types'

interface Props {
  mappings: FieldMapping[]
  parsedFile: ParsedFile
  onChange: (destinationField: string, source: string | null) => void
}

export function MappingStep({ mappings, parsedFile, onChange }: Props) {
  const headers = parsedFile.headers
  const extra = useMemo(
    () => findExtraSourceHeaders(headers, mappings, QONEX_SOURCE_FIELDS),
    [headers, mappings],
  )
  const summary = useMemo(
    () => computeMappingSummary(mappings, headers, extra),
    [mappings, headers, extra],
  )
  const unverifiedCount = mappings.filter((m) => !m.verified).length

  return (
    <div className="flex flex-col gap-6">
      <MappingSummaryCards summary={summary} />

      {summary.requiredMissing > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Terdapat field wajib yang belum terpetakan</AlertTitle>
          <AlertDescription>
            {summary.requiredMissing} field tujuan bertipe <em>required</em> belum
            memiliki sumber. Perbaiki mapping sebelum melanjutkan ke validasi.
          </AlertDescription>
        </Alert>
      )}

      {unverifiedCount > 0 && (
        <Alert variant="warning">
          <AlertTitle>{unverifiedCount} mapping belum terverifikasi</AlertTitle>
          <AlertDescription>
            Spesifikasi tujuan belum sepenuhnya tersedia. Setiap mapping bertanda
            {' '}
            <Badge variant="warning" className="align-middle">
              Mapped · Unverified
            </Badge>{' '}
            harus dikonfirmasi dengan tim tujuan sebelum Phase 2.
          </AlertDescription>
        </Alert>
      )}

      {extra.length > 0 && (
        <Alert variant="info">
          <AlertTitle>Kolom tambahan di file sumber</AlertTitle>
          <AlertDescription>
            {extra.length} kolom berikut tidak dikenal dan akan diabaikan:
            <div className="mt-2 flex flex-wrap gap-1.5">
              {extra.map((h) => (
                <Badge key={h} variant="muted">
                  {h}
                </Badge>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <MappingTable
        mappings={mappings}
        availableSourceHeaders={headers}
        onChangeSource={onChange}
      />
    </div>
  )
}
