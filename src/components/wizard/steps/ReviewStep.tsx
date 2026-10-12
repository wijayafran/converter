import { useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { ValidationIssueTable } from '@/components/shared/ValidationIssueTable'
import { ValidationSummary } from '@/components/shared/ValidationSummary'
import { DataPreview } from '@/components/shared/DataPreview'
import type { ParsedFile, ValidationIssue } from '@/types'

interface Props {
  parsedFile: ParsedFile
  issues: ValidationIssue[]
  onDecide: (
    issueId: string,
    decision: 'approve' | 'exclude' | null,
  ) => void
}

export function ReviewStep({ parsedFile, issues, onDecide }: Props) {
  const [severityFilter, setSeverityFilter] = useState<
    'all' | 'BLOCKED' | 'WARNING' | 'VALID'
  >('all')

  const visibleIssues = useMemo(
    () =>
      issues.filter((i) =>
        severityFilter === 'all' ? true : i.severity === severityFilter,
      ),
    [issues, severityFilter],
  )
  const blocking = issues.filter(
    (i) => i.severity === 'BLOCKED' && i.decision !== 'exclude',
  ).length

  return (
    <div className="flex flex-col gap-6">
      {blocking > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>
            {blocking} baris masih terblokir
          </AlertTitle>
          <AlertDescription>
            Perbaiki data pada sumber atau kecualikan baris sebelum
            melanjutkan ke preview.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="success">
          <AlertTitle>Tidak ada blocker aktif</AlertTitle>
          <AlertDescription>
            Anda dapat melanjutkan ke preview. Keputusan Anda akan diingat
            selama sesi ini.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="issues">
        <TabsList>
          <TabsTrigger value="issues">Issues Only</TabsTrigger>
          <TabsTrigger value="preview">Data Preview</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="issues">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(['all', 'BLOCKED', 'WARNING', 'VALID'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSeverityFilter(s)}
                className="focus:outline-none"
              >
                <Badge
                  variant={
                    severityFilter === s
                      ? s === 'BLOCKED'
                        ? 'destructive'
                        : s === 'WARNING'
                          ? 'warning'
                          : s === 'VALID'
                            ? 'success'
                            : 'default'
                      : 'outline'
                  }
                  className="cursor-pointer"
                >
                  {s === 'all' ? 'Semua' : s}
                </Badge>
              </button>
            ))}
          </div>
          <ValidationIssueTable issues={visibleIssues} onDecide={onDecide} />
        </TabsContent>

        <TabsContent value="preview">
          <DataPreview file={parsedFile} />
        </TabsContent>

        <TabsContent value="summary">
          <ValidationSummary
            totalRecords={parsedFile.rowCount}
            issues={issues}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
