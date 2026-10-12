import type { WizardStep } from '@/types'

export const WIZARD_STEPS: WizardStep[] = [
  {
    id: 'upload',
    label: 'Upload',
    description: 'Pilih file Excel Qonex.',
  },
  {
    id: 'mapping',
    label: 'Mapping',
    description: 'Review pemetaan sumber ke tujuan.',
  },
  {
    id: 'validation',
    label: 'Validation',
    description: 'Jalankan pemeriksaan otomatis.',
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Putuskan tindakan untuk setiap issue.',
  },
  {
    id: 'preview',
    label: 'Preview',
    description: 'Lihat output akhir sebelum migrasi.',
  },
  {
    id: 'result',
    label: 'Result',
    description: 'Hasil migrasi (simulated).',
  },
]
