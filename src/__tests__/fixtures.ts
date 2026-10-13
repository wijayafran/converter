import type { ParsedFile } from '@/types'
import { QONEX_SOURCE_FIELDS } from '@/config/qonex-source'

export function buildParsedFile(
  rows: Array<Record<string, unknown>>,
  overrides: Partial<ParsedFile> = {},
): ParsedFile {
  return {
    fileName: 'test-fixture.xlsx',
    fileSize: 10_000,
    sheetName: 'Leads',
    rowCount: rows.length,
    columnCount: QONEX_SOURCE_FIELDS.length,
    headers: [...QONEX_SOURCE_FIELDS],
    rows,
    ...overrides,
  }
}

export function validRow(overrides: Record<string, unknown> = {}) {
  return {
    ID: 'QX-00001',
    create: '2026-02-01 09:14',
    nama_prospek: 'Budi Santoso',
    nomor_telepon: '0812-3456-7890',
    email: 'budi.s@example.com',
    status: 'HOT',
    interest_type: 'Unit',
    type_price: '1.5M - 2M',
    source_data: 'Referral',
    category_source: 'Teman',
    lokasi_pameran: '',
    lokasi_walkin: 'Marketing Gallery A',
    sales_rep: 'Siti R.',
    group: 'Vireya',
    keterangan: 'Follow up Senin',
    cancel_reason: '',
    last_update: '2026-02-03 15:00',
    next_action: '2026-02-05 10:00',
    lat: -6.21462,
    long: 106.84513,
    attachment: '',
    bookmark: 1,
    cluster: 'Cendana',
    total_progress: 3,
    total_wa: 7,
    total_call: 2,
    visit_at: '2026-02-02',
    first_contact: '2026-02-01',
    ad_name: 'Promo Februari',
    adset_name: 'Jakarta Interest',
    form_name: 'Lead Form Feb',
    campaign_name: 'Launch Cendana',
    ...overrides,
  }
}

export function wonRow(overrides: Record<string, unknown> = {}) {
  return validRow({
    ID: 'QX-00099',
    nomor_telepon: '0877-1234-5678',
    status: 'WON',
    deal_value: '2500000000',
    ktp: '3201012345678901',
    project: 'Grand Ecovia',
    cluster: 'Altara Prime',
    block: 'A',
    unit_number: 'A-12',
    closed_on: '2026-02-10',
    ...overrides,
  })
}

export function buildLargeDataset(count: number) {
  const rows: Array<Record<string, unknown>> = []
  for (let i = 0; i < count; i++) {
    const n = String(i + 1).padStart(6, '0')
    const phoneSuffix = String(10000000 + i).slice(-8)
    rows.push(
      validRow({
        ID: `QX-${n}`,
        nama_prospek: `Prospek ${n}`,
        nomor_telepon: `0812${phoneSuffix}`,
        email: `prospek${n}@example.com`,
      }),
    )
  }
  return buildParsedFile(rows)
}
