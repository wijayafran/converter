import { useMemo, useState } from 'react'
import { Activity, Download, PlayCircle, ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { JsonPreview } from '@/components/shared/JsonPreview'
import { SqlPreview } from '@/components/shared/SqlPreview'
import { ConfirmationDialog } from '@/components/shared/ConfirmationDialog'
import { SQL_TARGET_TABLE } from '@/config/sql-mapping'
import {
  COSMOS_LEADS_CONTAINER,
  COSMOS_LEADS_WON_CONTAINER,
  DEFAULT_COSMOS_PROFILE,
  type CosmosProductProfile,
} from '@/config/cosmos-mapping'
import {
  buildCosmosBatchArray,
  buildSqlPreviewStatement,
  transformToCosmos,
  transformToSqlRecords,
} from '@/lib/transform'
import { downloadJson } from '@/lib/download'
import type { Destination, ParsedFile, ValidationIssue } from '@/types'
import type { AdapterConnectionProbe } from '@/lib/adapters/types'
import { COSMOS_DEV_STATUS, type ExecutionMode } from '@/state/workflow-store'

interface Props {
  destination: Destination
  parsedFile: ParsedFile
  issues: ValidationIssue[]
  executionMode: ExecutionMode
  backendProbe: AdapterConnectionProbe | null
  backendProbeError: string | null
  onProbeBackend: () => Promise<void> | void
  onExecutionModeChange: (mode: ExecutionMode) => void
  onConfirm: () => void
}

export function PreviewStep({
  destination,
  parsedFile,
  issues,
  executionMode,
  backendProbe,
  backendProbeError,
  onProbeBackend,
  onExecutionModeChange,
  onConfirm,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [profile, setProfile] = useState<CosmosProductProfile>(DEFAULT_COSMOS_PROFILE)

  const excludedRows = useMemo(
    () =>
      new Set(
        issues.filter((i) => i.decision === 'exclude').map((i) => i.rowIndex),
      ),
    [issues],
  )

  const sqlOutput = useMemo(() => {
    if (destination !== 'sql') return null
    const result = transformToSqlRecords(parsedFile, { dryRun: true })
    return {
      records: result.records
        .filter((r) => !r.blocked && !excludedRows.has(r.rowIndex))
        .map((r) => r.record),
      summary: result.summary,
    }
  }, [destination, parsedFile, excludedRows])

  const cosmosOutput = useMemo(() => {
    if (destination !== 'lemon') return null
    const result = transformToCosmos(parsedFile, {
      dryRun: true,
      config: { profile, waMobilePrefix: 'wa_' },
    })
    const leads = result.leads
      .filter((r) => !r.blocked && !excludedRows.has(r.rowIndex))
      .map((r) => r.record)
    const won = result.wonSnapshots
      .filter((r) => !r.blocked && !excludedRows.has(r.rowIndex))
      .map((r) => r.record)
    const batchArray = buildCosmosBatchArray({
      ...result,
      leads: result.leads.filter((l) => !l.blocked && !excludedRows.has(l.rowIndex)),
      wonSnapshots: result.wonSnapshots.filter(
        (w) => !w.blocked && !excludedRows.has(w.rowIndex),
      ),
    })
    return { leads, won, batchArray, summary: result.summary }
  }, [destination, parsedFile, excludedRows, profile])

  const sqlStatement = useMemo(
    () =>
      destination === 'sql' && sqlOutput
        ? buildSqlPreviewStatement(sqlOutput.records, 3)
        : '',
    [destination, sqlOutput],
  )

  const warnings = issues.filter((i) => i.severity === 'WARNING').length
  const blocked = issues.filter(
    (i) => i.severity === 'BLOCKED' && i.decision !== 'exclude',
  ).length
  const transformedCount =
    destination === 'sql'
      ? sqlOutput?.records.length ?? 0
      : cosmosOutput?.leads.length ?? 0

  const isSql = destination === 'sql'
  const isLive = isSql && executionMode === 'SQL_LOCAL_TEST'
  const backendOk = backendProbe?.ok === true

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryTile label="Records siap" value={transformedCount} />
        <SummaryTile label="Dikecualikan" value={excludedRows.size} />
        <SummaryTile label="Warning" value={warnings} tone="warning" />
        <SummaryTile label="Blocked" value={blocked} tone="destructive" />
      </div>

      {isSql ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-heading">Execution mode</p>
              <p className="text-xs text-muted-foreground">
                Dry Run tidak menulis apa pun. SQL Local Test memanggil
                backend lokal yang menulis ke container{' '}
                <code className="font-mono text-[11px]">lemons-mssql</code>.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onExecutionModeChange('DRY_RUN')}
                className="focus:outline-none"
              >
                <Badge
                  variant={executionMode === 'DRY_RUN' ? 'default' : 'outline'}
                  className="cursor-pointer uppercase"
                >
                  Dry Run
                </Badge>
              </button>
              <button
                type="button"
                onClick={() => onExecutionModeChange('SQL_LOCAL_TEST')}
                className="focus:outline-none"
              >
                <Badge
                  variant={executionMode === 'SQL_LOCAL_TEST' ? 'default' : 'outline'}
                  className="cursor-pointer uppercase"
                >
                  SQL Local Test
                </Badge>
              </button>
            </div>
          </div>

          {executionMode === 'SQL_LOCAL_TEST' && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 p-3 text-xs">
              <Activity
                className={`h-4 w-4 ${
                  backendOk
                    ? 'text-[hsl(var(--success))]'
                    : backendProbeError
                      ? 'text-[hsl(var(--destructive))]'
                      : 'text-muted-foreground'
                }`}
              />
              <span className="font-medium">Backend</span>
              {backendProbe ? (
                <span className="text-muted-foreground">
                  {backendProbe.destinationLabel} ·{' '}
                  <span className="font-mono">{backendProbe.mode}</span> ·{' '}
                  latency {backendProbe.latencyMs}ms
                </span>
              ) : backendProbeError ? (
                <span className="text-[hsl(var(--destructive))]">
                  {backendProbeError}
                </span>
              ) : (
                <span className="text-muted-foreground">Belum diprobe</span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => onProbeBackend()}
                className="ml-auto"
              >
                Probe backend
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Alert variant="warning">
          <AlertTitle>Cosmos DEV integration pending</AlertTitle>
          <AlertDescription>{COSMOS_DEV_STATUS}</AlertDescription>
        </Alert>
      )}

      <Alert variant={isLive ? 'info' : 'warning'}>
        <AlertTitle>
          {isLive
            ? 'SQL Local Test — writes to lemons-mssql'
            : 'DRY RUN — no writes'}
        </AlertTitle>
        <AlertDescription>
          {isLive
            ? 'Backend akan INSERT ke dev_analytic_cxlite.analytic_leads_sales, dilanjutkan read-back verification. Tabel eventlog tidak disentuh.'
            : destination === 'lemon'
              ? 'Cosmos lokal dinonaktifkan di Phase 2B. Semua angka adalah output MOCK; tidak ada tulisan ke database apa pun.'
              : 'Mode DRY RUN pakai MOCK adapter. Tidak ada tulisan ke lemons-mssql. Pilih SQL Local Test untuk mengeksekusi.'}
        </AlertDescription>
      </Alert>

      {destination === 'lemon' && cosmosOutput ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="section-heading">Cosmos output · profile</p>
            <div className="flex gap-2">
              {(['lite', 'pro'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProfile(p)}
                  className="focus:outline-none"
                >
                  <Badge
                    variant={profile === p ? 'default' : 'outline'}
                    className="cursor-pointer uppercase"
                  >
                    {p}
                  </Badge>
                </button>
              ))}
              <Badge variant="muted">MOCK · DEV pending</Badge>
            </div>
          </div>

          <div>
            <p className="section-heading mb-2">
              Container <code className="font-mono text-xs">{COSMOS_LEADS_CONTAINER}</code>
              {' '}
              ({cosmosOutput.leads.length.toLocaleString('id-ID')})
            </p>
            <JsonPreview data={cosmosOutput.leads.slice(0, 5)} />
          </div>

          <div>
            <p className="section-heading mb-2">
              Container <code className="font-mono text-xs">{COSMOS_LEADS_WON_CONTAINER}</code>
              {' '}
              ({cosmosOutput.won.length.toLocaleString('id-ID')})
            </p>
            {cosmosOutput.won.length > 0 ? (
              <JsonPreview data={cosmosOutput.won.slice(0, 5)} />
            ) : (
              <p className="text-xs text-muted-foreground">
                Tidak ada record won/dropped yang lolos validasi untuk disnapshot.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() =>
                downloadJson(cosmosOutput.leads, 'cosmos-leads-dry-run.json')
              }
            >
              <Download className="h-4 w-4" />
              Download leads JSON
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadJson(cosmosOutput.won, 'cosmos-leads-won-dry-run.json')
              }
              disabled={cosmosOutput.won.length === 0}
            >
              <Download className="h-4 w-4" />
              Download leads-won JSON
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadJson(cosmosOutput.batchArray, 'cosmos-batch-array.json')
              }
            >
              <Download className="h-4 w-4" />
              Download batch array
            </Button>
            <Button variant="outline" disabled title="Pending Azure DEV + Lemon Vireya contract">
              <ShieldAlert className="h-4 w-4" />
              Submit via Lemon Vireya (pending)
            </Button>
          </div>
        </div>
      ) : null}

      {destination === 'sql' && sqlOutput ? (
        <div className="flex flex-col gap-3">
          <SqlPreview
            rows={sqlOutput.records as Array<Record<string, unknown>>}
            statement={sqlStatement}
            tableName={SQL_TARGET_TABLE}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() =>
                downloadJson(sqlOutput.records, 'sql-leads-dry-run.json')
              }
            >
              <Download className="h-4 w-4" />
              Download SQL rows (JSON)
            </Button>
            <Button variant="outline" onClick={() => onProbeBackend()}>
              <Activity className="h-4 w-4" />
              Probe backend health
            </Button>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-background p-5">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-base font-medium">
              {isLive ? 'Confirm & run SQL Local Test' : 'Confirm & run (DRY RUN)'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isLive
                ? 'Backend akan menerima batch, INSERT ke SQL, lalu verifikasi read-back. Credentials tetap di server.'
                : 'Batch engine akan dijalankan dengan MOCK adapter. Tidak ada penulisan ke sistem apa pun.'}
            </p>
          </div>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={
              blocked > 0 ||
              transformedCount === 0 ||
              (isLive && !backendOk)
            }
          >
            <PlayCircle className="h-4 w-4" />
            {isLive ? 'Confirm & run SQL Local Test' : 'Confirm & run migration (DRY RUN)'}
          </Button>
        </div>
      </div>

      <ConfirmationDialog
        open={confirmOpen}
        title={isLive ? 'Konfirmasi SQL Local Test' : 'Konfirmasi DRY RUN migrasi'}
        description={
          isLive
            ? `Backend akan menerima ${transformedCount.toLocaleString('id-ID')} record dan menulisnya ke dev_analytic_cxlite.analytic_leads_sales pada container lemons-mssql, lalu memverifikasi dengan SELECT. Tabel eventlog tidak akan diubah.`
            : `Batch engine akan dijalankan untuk ${transformedCount.toLocaleString('id-ID')} record ke tujuan ${
                destination === 'lemon' ? 'Cosmos (MOCK · DEV pending)' : 'SQL (MOCK)'
              }. Tidak ada tulisan ke database apa pun.`
        }
        confirmLabel={isLive ? 'Jalankan SQL Local Test' : 'Jalankan DRY RUN'}
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
