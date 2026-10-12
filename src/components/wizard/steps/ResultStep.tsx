import { MigrationResult } from '@/components/shared/MigrationResult'
import { EmptyState } from '@/components/shared/states'
import type { MigrationResultSummary } from '@/types'

interface Props {
  result: MigrationResultSummary | null
  onStartOver: () => void
}

export function ResultStep({ result, onStartOver }: Props) {
  if (!result) {
    return (
      <EmptyState
        title="Belum ada hasil"
        description="Selesaikan preview & confirm untuk menghasilkan laporan migrasi."
      />
    )
  }
  return <MigrationResult result={result} onStartOver={onStartOver} />
}
