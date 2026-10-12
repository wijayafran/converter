import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { WizardStep, WizardStepId } from '@/types'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

interface Props {
  steps: WizardStep[]
  currentStepId: WizardStepId
  canContinue: boolean
  continueLabel?: string
  showContinue?: boolean
  onBack?: () => void
  onContinue?: () => void
  onJumpTo?: (step: WizardStepId) => void
  children: ReactNode
  heading: string
  description: string
  isReachable?: (stepId: WizardStepId) => boolean
}

export function MigrationWizard({
  steps,
  currentStepId,
  canContinue,
  continueLabel = 'Continue',
  showContinue = true,
  onBack,
  onContinue,
  onJumpTo,
  children,
  heading,
  description,
  isReachable,
}: Props) {
  const currentIdx = useMemo(
    () => steps.findIndex((s) => s.id === currentStepId),
    [steps, currentStepId],
  )

  return (
    <div className="flex min-h-full flex-col">
      <div className="py-4">
        <Stepper
          steps={steps}
          currentIdx={currentIdx}
          onJumpTo={onJumpTo}
          isReachable={isReachable}
        />
      </div>

      <div className="flex-1 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>

      <div className="sticky bottom-0 border-t border-border bg-background/80 py-4 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-muted-foreground">
            Step {currentIdx + 1} of {steps.length}
          </div>
          <div className="flex items-center gap-2">
            {onBack && (
              <Button variant="outline" onClick={onBack}>
                Back
              </Button>
            )}
            {showContinue && onContinue && (
              <Button onClick={onContinue} disabled={!canContinue}>
                {continueLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface StepperProps {
  steps: WizardStep[]
  currentIdx: number
  onJumpTo?: (step: WizardStepId) => void
  isReachable?: (stepId: WizardStepId) => boolean
}

function Stepper({ steps, currentIdx, onJumpTo, isReachable }: StepperProps) {
  const safeIdx = Math.max(0, currentIdx)
  const current = steps[safeIdx]
  const progressValue = ((safeIdx + 1) / steps.length) * 100

  return (
    <nav aria-label="Migration progress">
      <ol className="hidden items-center gap-1 md:flex" role="list">
        {steps.map((step, idx) => {
          const isPast = idx < currentIdx
          const isActive = idx === currentIdx
          const reachable = isReachable ? isReachable(step.id) : idx <= currentIdx
          const clickable = Boolean(onJumpTo) && reachable && !isActive
          return (
            <li
              key={step.id}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2',
                idx === steps.length - 1 && 'flex-none',
              )}
              aria-current={isActive ? 'step' : undefined}
            >
              <button
                type="button"
                onClick={() => clickable && onJumpTo?.(step.id)}
                disabled={!clickable}
                aria-label={`Step ${idx + 1}: ${step.label}${
                  isActive
                    ? ' (current)'
                    : isPast
                      ? ' (completed)'
                      : ''
                }`}
                className={cn(
                  'group flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  clickable
                    ? 'cursor-pointer hover:bg-muted/50'
                    : 'cursor-default',
                  !isActive && !isPast && !reachable && 'opacity-50',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                    isActive &&
                      'border-primary bg-primary text-primary-foreground',
                    isPast &&
                      'border-primary bg-primary text-primary-foreground',
                    !isActive &&
                      !isPast &&
                      'border-border bg-background text-muted-foreground',
                  )}
                  aria-hidden
                >
                  {isPast ? <Check className="h-3.5 w-3.5" /> : idx + 1}
                </span>
                <span
                  className={cn(
                    'truncate text-sm font-medium',
                    isActive
                      ? 'text-foreground'
                      : isPast
                        ? 'text-foreground/80'
                        : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
              </button>
              {idx < steps.length - 1 && (
                <span
                  className={cn(
                    'h-px flex-1 min-w-[12px]',
                    isPast ? 'bg-primary' : 'bg-border',
                  )}
                  aria-hidden
                />
              )}
            </li>
          )
        })}
      </ol>

      <div className="flex flex-col gap-2 md:hidden">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Step {safeIdx + 1} of {steps.length}
          </span>
          <span className="truncate font-medium">{current?.label}</span>
        </div>
        <Progress value={progressValue} />
      </div>
    </nav>
  )
}
