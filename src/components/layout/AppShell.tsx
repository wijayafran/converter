import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, Boxes } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface Props {
  children: ReactNode
}

export function AppShell({ children }: Props) {
  const location = useLocation()
  const inWorkflow = location.pathname.startsWith('/workflow')

  return (
    <div className="flex min-h-full flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="container flex h-14 items-center justify-between gap-4">
          <Link
            to="/"
            className="flex items-center gap-2"
            aria-label="LEMONS Data Migrations Ecovia — home"
          >
            <div className="rounded-md border border-border bg-foreground p-1.5 text-background">
              <Boxes className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">
                LEMONS Data Migrations Ecovia
              </div>
              <div className="text-[11px] text-muted-foreground">
                Internal · Local Development
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            {inWorkflow && (
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Kembali ke beranda
              </Link>
            )}
            <Badge variant="muted">Local Development</Badge>
          </div>
        </div>
      </header>

      <main className="container flex-1">{children}</main>

      <footer className="border-t border-border py-6">
        <div className="container flex flex-col items-start justify-between gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <span>
            © Qonex Internal — local SQL Server POC. Not connected to production.
          </span>
          <span>Local Development · v0.1.0</span>
        </div>
      </footer>
    </div>
  )
}
