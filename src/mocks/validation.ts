import type { Destination, ValidationIssue } from '@/types'

export function buildMockIssues(destination: Destination): ValidationIssue[] {
  const issues: ValidationIssue[] = [
    {
      id: 'iss-001',
      rowIndex: 3,
      severity: 'BLOCKED',
      category: 'missing-required',
      sourceField: 'nama_prospek',
      destinationField: destination === 'lemon' ? 'name' : 'leads_customer_name',
      originalValue: '',
      proposedValue: null,
      description: 'Nama prospek kosong — field wajib untuk tujuan.',
      recommendedAction:
        'Perbaiki pada file sumber (tambahkan nama) atau kecualikan baris ini.',
    },
    {
      id: 'iss-002',
      rowIndex: 3,
      severity: 'WARNING',
      category: 'invalid-phone',
      sourceField: 'nomor_telepon',
      destinationField:
        destination === 'lemon' ? 'contact.phone' : 'leads_customer_phone',
      originalValue: '0899 999 999',
      proposedValue: '+62899999999',
      description:
        'Nomor telepon kurang dari standar panjang Indonesia (10–13 digit).',
      recommendedAction: 'Konfirmasi kebenaran nomor sebelum migrasi.',
    },
    {
      id: 'iss-003',
      rowIndex: 3,
      severity: 'WARNING',
      category: 'invalid-type',
      sourceField: 'email',
      destinationField:
        destination === 'lemon' ? 'contact.email' : 'leads_customer_email',
      originalValue: 'not-an-email',
      proposedValue: null,
      description: 'Format email tidak valid (tidak mengandung "@").',
      recommendedAction: 'Perbaiki pada sumber atau kosongkan field email.',
    },
    {
      id: 'iss-004',
      rowIndex: 2,
      severity: 'WARNING',
      category: 'precision-loss',
      sourceField: 'lat',
      destinationField: destination === 'lemon' ? 'geo.lat' : 'leads_latitude',
      originalValue: -6.9039183,
      proposedValue: -6.903918,
      description:
        destination === 'lemon'
          ? 'Lemon menerima 7 desimal; nilai akan dibulatkan.'
          : 'Kolom DECIMAL(9,6) hanya menampung 6 desimal.',
      recommendedAction:
        'Pastikan presisi tersebut dapat diterima sebelum menyetujui.',
    },
    {
      id: 'iss-005',
      rowIndex: 2,
      severity: 'VALID',
      category: 'mapping-incompatible',
      sourceField: 'email',
      destinationField:
        destination === 'lemon' ? 'contact.email' : 'leads_customer_email',
      originalValue: 'DEWI@example.com',
      proposedValue: 'dewi@example.com',
      description: 'Email akan dinormalisasi menjadi huruf kecil.',
      recommendedAction: 'Tidak ada tindakan diperlukan.',
    },
  ]

  if (destination === 'sql') {
    issues.push({
      id: 'iss-006',
      rowIndex: 1,
      severity: 'WARNING',
      category: 'destination-constraint',
      sourceField: 'keterangan',
      destinationField: 'leads_notes',
      originalValue: 'Follow up Senin',
      proposedValue: 'Follow up Senin',
      description:
        'Nilai saat ini valid, namun kolom tujuan NVARCHAR(MAX) belum dikonfirmasi (lihat open questions).',
      recommendedAction: 'Verifikasi DDL sebelum menyetujui migrasi penuh.',
    })
  }

  return issues
}
