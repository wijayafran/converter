import { CheckCircle2, CircleSlash, Undo2 } from 'lucide-react'
import type { ValidationIssue } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Props {
  issues: ValidationIssue[]
  onDecide: (
    issueId: string,
    decision: 'approve' | 'exclude' | null,
  ) => void
}

const severityVariant = {
  VALID: 'success',
  WARNING: 'warning',
  BLOCKED: 'destructive',
} as const

export function ValidationIssueTable({ issues, onDecide }: Props) {
  if (issues.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-12 text-sm text-muted-foreground">
        Tidak ada issue — semua baris lolos validasi (simulasi).
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Baris</TableHead>
            <TableHead className="w-28">Severity</TableHead>
            <TableHead>Field</TableHead>
            <TableHead>Nilai asli</TableHead>
            <TableHead>Nilai usulan</TableHead>
            <TableHead>Deskripsi</TableHead>
            <TableHead className="w-56">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.map((issue) => (
            <TableRow key={issue.id}>
              <TableCell className="font-mono">{issue.rowIndex}</TableCell>
              <TableCell>
                <Badge variant={severityVariant[issue.severity]}>
                  {issue.severity}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="font-mono text-xs">{issue.sourceField}</div>
                <div className="text-[11px] text-muted-foreground">
                  → {issue.destinationField}
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs">
                {renderValue(issue.originalValue)}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {renderValue(issue.proposedValue)}
              </TableCell>
              <TableCell className="max-w-sm">
                <p className="text-sm">{issue.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {issue.recommendedAction}
                </p>
              </TableCell>
              <TableCell>
                <IssueActions issue={issue} onDecide={onDecide} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function renderValue(v: string | number | null) {
  if (v === null || v === '') return <span className="text-muted-foreground">—</span>
  return String(v)
}

function IssueActions({
  issue,
  onDecide,
}: {
  issue: ValidationIssue
  onDecide: (
    issueId: string,
    decision: 'approve' | 'exclude' | null,
  ) => void
}) {
  if (issue.decision === 'approve') {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="success">Disetujui</Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDecide(issue.id, null)}
        >
          <Undo2 className="h-3.5 w-3.5" />
          Batal
        </Button>
      </div>
    )
  }
  if (issue.decision === 'exclude') {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="muted">Dikecualikan</Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDecide(issue.id, null)}
        >
          <Undo2 className="h-3.5 w-3.5" />
          Batal
        </Button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      {issue.severity === 'WARNING' && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDecide(issue.id, 'approve')}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Setujui
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDecide(issue.id, 'exclude')}
      >
        <CircleSlash className="h-3.5 w-3.5" />
        Kecualikan baris
      </Button>
    </div>
  )
}
