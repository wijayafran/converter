import { useNavigate } from 'react-router-dom'
import { Database, FileJson } from 'lucide-react'
import { DestinationCard } from '@/components/shared/DestinationCard'
import { useWorkflowStore } from '@/state/workflow-store'

export function LandingPage() {
  const navigate = useNavigate()
  const startWorkflow = useWorkflowStore((s) => s.startWorkflow)

  const start = (dest: 'lemon' | 'sql') => {
    startWorkflow(dest)
    navigate(`/workflow/${dest}`)
  }

  return (
    <div className="flex flex-col gap-10 py-10">
      <section className="text-center">
        <p className="section-heading mb-3">Internal migration tool</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          LEMONS Data Migrations Ecovia
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
          Prepare, validate, and migrate your customer data safely. Pilih tujuan
          di bawah untuk memulai; setiap alur memiliki wizard tersendiri dengan
          pratinjau transparan sebelum migrasi dijalankan.
        </p>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <DestinationCard
          icon={FileJson}
          title="Lemon / CXLite Migration"
          tagline="Qonex Excel → Lemon JSON"
          description="Convert Qonex Excel data into Lemon-compatible JSON and prepare it for API submission."
          stackLine="Target: Lemon / CXLite API · Storage: Azure Cosmos DB"
          onStart={() => start('lemon')}
        />
        <DestinationCard
          icon={Database}
          title="SQL Server Migration"
          tagline="Qonex Excel → SQL Server rows"
          description="Validate and prepare Qonex customer data for insertion into SQL Server."
          stackLine="Target: Microsoft SQL Server · Table: dbo.leads"
          onStart={() => start('sql')}
        />
      </section>

      <section className="rounded-lg border border-dashed border-border bg-muted/20 p-5 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Phase 1 scope.</span>{' '}
          Antarmuka ini adalah prototipe end-to-end untuk validasi oleh pengguna.
          Parsing Excel dilakukan di browser; penulisan ke Lemon API atau SQL
          Server <em>tidak</em> dilakukan hingga Phase 2.
        </p>
      </section>
    </div>
  )
}
