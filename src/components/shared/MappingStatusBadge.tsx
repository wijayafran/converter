import type { FieldMapping } from '@/types'
import { Badge } from '@/components/ui/badge'

interface Props {
  mapping: FieldMapping
  mapped: boolean
}

export function MappingStatusBadge({ mapping, mapped }: Props) {
  if (!mapped) {
    return mapping.requirement === 'required' ? (
      <Badge variant="destructive">Required · Missing</Badge>
    ) : (
      <Badge variant="muted">Optional · Not mapped</Badge>
    )
  }
  if (mapping.type === 'Generated')
    return <Badge variant="outline">Generated</Badge>
  if (mapping.type === 'Default')
    return <Badge variant="outline">Default</Badge>
  if (!mapping.verified)
    return <Badge variant="warning">Mapped · Unverified</Badge>
  return <Badge variant="success">Mapped</Badge>
}
