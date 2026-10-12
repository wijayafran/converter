import { useMemo, useState } from 'react'
import { Download, PlayCircle, ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { JsonPreview } from '@/components/shared/JsonPreview'
import { SqlPreview } from '@/components/shared/SqlPreview'
import { ConfirmationDialog } from '@/components/shared/ConfirmationDialog'
import { SQL_TARGET_TABLE } from '@/config/sql-mapping'
import {
  buildSqlPreviewStatement,
  transformToLemon,
  transformToSqlRows,
} from '@/lib/transform'
import { downloadJson } from '@/lib/download'
import type { Destination, ParsedFile, ValidationIssue } from '@/types'

interface Props {
  destination: Destination
  parsedFile: ParsedFile
  issues: ValidationIssue[]
  onConfirm: () => void
}

export function PreviewStep({
  destination,
  parsedFile,
  issues,
  onConfirm,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  const excludedRows = useMemo(() => {
    return new Set(
      issues
        .filter((i) => i.decision === 'exclude')
        .map((i) => i.rowIndex - 1),
    )
  }, [issues])

  const effectiveFile = useMemo<ParsedFile>(
    () => ({
      ...parsedFile,
      rows: parsedFile.rows.filter((_, idx) => !excludedRows.has(idx)),
      rowCount: parsedFile.rowCount - excludedRows.size,
    }),
    [parsedFile, excludedRows],
  )

  const transformed = useMemo(
    () =>
      destination === 'lemon'
        ? transformToLemon(effectiveFile)
        : transformToSqlRows(effectiveFile),
    [destination, effectiveFile],
  )

  const sqlStatement = useMemo(
    () =>
      destination === 'sql'
        ? buildSqlPreviewStatement(transformed, 3)
        : '',
    [destination, transformed],
  )

  const warnings = issues.filter((i) => i.severity === 'WARNING').length
  const blocked = issues.filter(
    (i) => i.severity === 'BLOCKED' && i.decision !== 'exclude',
  ).length

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryTile label="Records siap" value={transformed.length} />
        <SummaryTile label="Dikecualikan" value={excludedRows.size} />
        <SummaryTile label="Warning" value={warnings} tone="warning" />
        <SummaryTile label="Blocked" value={blocked} tone="destructive" />
      </div>

      <Alert variant="warning">
        <AlertTitle>Integrasi tujuan belum tersedia</AlertTitle>
        <AlertDescription>
          {destination === 'lemon'
            ? 'Submit ke Lemon / CXLite API akan tersedia pada Phase 2. Pada Phase 1 Anda dapat mengunduh file JSON untuk ditinjau.'
            : 'Eksekusi INSERT ke SQL Server akan tersedia pada Phase 2 melalui backend aman. Pada Phase 1 Anda dapat meninjau pratinjau statement.'}
        </AlertDescription>
      </Alert>

      {destination === 'lemon' ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="section-heading">Generated JSON</p>
            <Badge variant="muted">
              Profile: lemon-default (illustrative)
            </Badge>
          </div>
          <JsonPreview data={transformed.slice(0, 10)} />
          <p className="text-xs text-muted-foreground">
            Menampilkan {Math.min(10, transformed.length)} record pertama.
            Download berisi seluruh {transformed.length.toLocaleString('id-ID')}{' '}
            record.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() =>
                downloadJson(transformed, 'qonex-lemon-preview.json')
              }
            >
              <Download className="h-4 w-4" />
              Download JSON
            </Button>
            <Button
              variant="outline"
              disabled
              title="Available in Phase 2"
            >
              <ShieldAlert className="h-4 w-4" />
              Submit to Lemon API (Phase 2)
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <SqlPreview
            rows={transformed}
            statement={sqlStatement}
            tableName={SQL_TARGET_TABLE}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled
              title="Available in Phase 2"
            >
              <ShieldAlert className="h-4 w-4" />
              Test Connection (Phase 2)
            </Button>
            <Button
              variant="outline"
              disabled
              title="Available in Phase 2"
            >
              <ShieldAlert className="h-4 w-4" />
              Execute INSERT (Phase 2)
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-background p-5">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-base font-medium">Confirm & simulate</h3>
            <p className="text-sm text-muted-foreground">
              Simulasi migrasi akan merekam hasil, tanpa penulisan nyata ke
              sistem tujuan.
            </p>
          </div>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={blocked > 0 || transformed.length === 0}
          >
            <PlayCircle className="h-4 w-4" />
            Confirm & simulate migration
          </Button>
        </div>
      </div>

      <ConfirmationDialog
        open={confirmOpen}
        title="Konfirmasi simulasi migrasi"
        description={`Simulasi akan dijalankan untuk ${transformed.length.toLocaleString(
          'id-ID',
        )} record ke tujuan ${
          destination === 'lemon' ? 'Lemon / CXLite' : 'SQL Server'
        }. Tidak ada data yang akan dikirim ke sistem produksi.`}
        confirmLabel="Jalankan simulasi"
        onConfirm={() => {
          setConfirmOpen(false)
          onConfirm()
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'warning' | 'destructive'
}) {
  const toneClass =
    tone === 'warning'
      ? 'text-[hsl(var(--warning))]'
      : tone === 'destructive'
        ? 'text-[hsl(var(--destructive))]'
        : 'text-foreground'
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  )
}
