import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { FieldMapping, MappingRequirement } from '@/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { MappingStatusBadge } from './MappingStatusBadge'

interface Props {
  mappings: FieldMapping[]
  availableSourceHeaders: string[]
  onChangeSource: (destinationField: string, source: string | null) => void
}

type Filter = 'all' | 'required-missing' | 'unverified' | 'generated'

export function MappingTable({
  mappings,
  availableSourceHeaders,
  onChangeSource,
}: Props) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const rows = useMemo(() => {
    return mappings.filter((m) => {
      const mapped =
        (m.sourceField && availableSourceHeaders.includes(m.sourceField)) ||
        m.type === 'Default' ||
        m.type === 'Generated'
      if (filter === 'required-missing' && !(m.requirement === 'required' && !mapped))
        return false
      if (filter === 'unverified' && m.verified) return false
      if (filter === 'generated' && m.type !== 'Generated' && m.type !== 'Default')
        return false
      if (search) {
        const q = search.toLowerCase()
        return (
          m.destinationField.toLowerCase().includes(q) ||
          (m.sourceField ?? '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [mappings, availableSourceHeaders, search, filter])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-80">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari field tujuan atau sumber…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="sm:w-56"
        >
          <option value="all">Semua mapping</option>
          <option value="required-missing">Wajib · Hilang</option>
          <option value="unverified">Belum terverifikasi</option>
          <option value="generated">Generated / Default</option>
        </Select>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">Field tujuan</TableHead>
              <TableHead className="w-40">Tipe</TableHead>
              <TableHead>Sumber Qonex</TableHead>
              <TableHead>Catatan</TableHead>
              <TableHead className="w-44">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => {
              const mapped =
                (m.sourceField &&
                  availableSourceHeaders.includes(m.sourceField)) ||
                m.type === 'Default' ||
                m.type === 'Generated'
              const isSelectable = m.type !== 'Generated' && m.type !== 'Default'
              return (
                <TableRow key={m.destinationField}>
                  <TableCell>
                    <div className="font-mono text-xs">
                      {m.destinationPath ?? m.destinationField}
                    </div>
                    <RequirementBadge req={m.requirement} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{m.type}</Badge>
                  </TableCell>
                  <TableCell>
                    {isSelectable ? (
                      <Select
                        value={m.sourceField ?? ''}
                        onChange={(e) =>
                          onChangeSource(
                            m.destinationField,
                            e.target.value === '' ? null : e.target.value,
                          )
                        }
                      >
                        <option value="">— tidak dipetakan —</option>
                        {availableSourceHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="text-xs italic text-muted-foreground">
                        {m.type === 'Default'
                          ? 'nilai konstan'
                          : 'dihasilkan otomatis'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-sm text-xs text-muted-foreground">
                    {m.description}
                    {m.example && (
                      <div className="mt-1 font-mono text-[11px] text-foreground/70">
                        {m.example}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <MappingStatusBadge mapping={m} mapped={mapped} />
                  </TableCell>
                </TableRow>
              )
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  Tidak ada mapping yang sesuai dengan filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function RequirementBadge({ req }: { req: MappingRequirement }) {
  return (
    <span
      className={`mt-1 inline-block text-[10px] font-medium uppercase tracking-wider ${
        req === 'required'
          ? 'text-[hsl(var(--destructive))]'
          : 'text-muted-foreground'
      }`}
    >
      {req}
    </span>
  )
}
