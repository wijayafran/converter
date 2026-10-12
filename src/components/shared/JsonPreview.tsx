interface Props {
  data: unknown
  maxLines?: number
}

export function JsonPreview({ data, maxLines = 400 }: Props) {
  const text = JSON.stringify(data, null, 2)
  const lines = text.split('\n')
  const truncated = lines.length > maxLines
  const display = truncated ? [...lines.slice(0, maxLines), '…'].join('\n') : text
  return (
    <pre className="scrollbar-slim max-h-[480px] overflow-auto rounded-lg border border-border bg-muted/30 p-4 text-xs leading-relaxed">
      <code className="font-mono">{display}</code>
      {truncated && (
        <div className="mt-2 text-xs text-muted-foreground">
          Dipotong setelah {maxLines} baris untuk pratinjau.
        </div>
      )}
    </pre>
  )
}
