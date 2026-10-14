import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useWorkflowStore } from '@/state/workflow-store'
import { WIZARD_STEPS } from '@/config/wizard'
import { MigrationWizard } from '@/components/wizard/MigrationWizard'
import { UploadStep } from '@/components/wizard/steps/UploadStep'
import { MappingStep } from '@/components/wizard/steps/MappingStep'
import { ValidationStep } from '@/components/wizard/steps/ValidationStep'
import { ReviewStep } from '@/components/wizard/steps/ReviewStep'
import { PreviewStep } from '@/components/wizard/steps/PreviewStep'
import { ResultStep } from '@/components/wizard/steps/ResultStep'
import { canProceedPastValidation } from '@/lib/mapping'
import type { Destination, WizardStepId } from '@/types'
import { EmptyState } from '@/components/shared/states'
import { Button } from '@/components/ui/button'

const DEST_META: Record<Destination, { label: string; description: string }> =
  {
    lemon: {
      label: 'Lemon / CXLite',
      description:
        'Konversi Qonex Excel menjadi JSON Lemon untuk dipersiapkan pengiriman via API.',
    },
    sql: {
      label: 'SQL Server',
      description:
        'Validasi dan persiapkan data pelanggan Qonex untuk insert ke SQL Server.',
    },
  }

export function WorkflowPage() {
  const params = useParams()
  const navigate = useNavigate()
  const destination = params.destination as Destination | undefined

  const {
    destination: storeDestination,
    currentStep,
    parsedFile,
    mappings,
    issues,
    result,
    validation,
    batchProgress,
    batchManifest,
    executionMode,
    backendProbe,
    backendProbeError,
    startWorkflow,
    setStep,
    setParsedFile,
    updateMapping,
    runValidation,
    decideIssue,
    simulateMigration,
    setExecutionMode,
    probeBackend,
  } = useWorkflowStore()

  useEffect(() => {
    if (!destination || !(destination in DEST_META)) {
      navigate('/')
      return
    }
    if (storeDestination !== destination) {
      startWorkflow(destination)
    }
  }, [destination, storeDestination, startWorkflow, navigate])

  const meta = destination ? DEST_META[destination] : null

  const requiredMissing = useMemo(() => {
    if (!parsedFile) return 1
    return mappings.filter(
      (m) =>
        m.requirement === 'required' &&
        m.sourceField &&
        !parsedFile.headers.includes(m.sourceField),
    ).length
  }, [mappings, parsedFile])

  const canContinueMap: Record<WizardStepId, boolean> = {
    upload: Boolean(parsedFile),
    mapping: Boolean(parsedFile) && requiredMissing === 0,
    validation: issues.length > 0,
    review: canProceedPastValidation(issues),
    preview: Boolean(result),
    result: false,
  }

  const isReachable = (stepId: WizardStepId) => {
    const stepIdx = WIZARD_STEPS.findIndex((s) => s.id === stepId)
    const current = WIZARD_STEPS.findIndex((s) => s.id === currentStep)
    if (stepIdx <= current) return true
    for (let i = 0; i < stepIdx; i++) {
      if (!canContinueMap[WIZARD_STEPS[i].id]) return false
    }
    return true
  }

  if (!destination || !meta) {
    return (
      <EmptyState
        title="Destinasi tidak dikenali"
        description="Kembali ke beranda untuk memilih tujuan migrasi."
        action={
          <Button variant="outline" onClick={() => navigate('/')}>
            Kembali ke beranda
          </Button>
        }
      />
    )
  }

  const stepIdx = WIZARD_STEPS.findIndex((s) => s.id === currentStep)
  const nextStep = WIZARD_STEPS[stepIdx + 1]?.id
  const prevStep = WIZARD_STEPS[stepIdx - 1]?.id
  const canContinue = canContinueMap[currentStep]
  const showContinue = currentStep !== 'preview' && currentStep !== 'result'

  const activeStep = WIZARD_STEPS[stepIdx]
  const heading = `${meta.label} migration · ${activeStep.label}`
  const pageDescription = activeStep.description

  return (
    <MigrationWizard
      steps={WIZARD_STEPS}
      currentStepId={currentStep}
      canContinue={canContinue}
      showContinue={showContinue}
      onBack={prevStep ? () => setStep(prevStep) : undefined}
      onContinue={nextStep ? () => setStep(nextStep) : undefined}
      onJumpTo={(step) => setStep(step)}
      isReachable={isReachable}
      heading={heading}
      description={pageDescription}
    >
      {currentStep === 'upload' && (
        <UploadStep
          parsedFile={parsedFile}
          destinationLabel={meta.label}
          onParsed={(f) => setParsedFile(f)}
          onClear={() => setParsedFile(null)}
        />
      )}
      {currentStep === 'mapping' && parsedFile && (
        <MappingStep
          mappings={mappings}
          parsedFile={parsedFile}
          onChange={updateMapping}
        />
      )}
      {currentStep === 'validation' && parsedFile && (
        <ValidationStep
          totalRecords={parsedFile.rowCount}
          issues={issues}
          onRun={runValidation}
        />
      )}
      {currentStep === 'review' && parsedFile && (
        <ReviewStep
          parsedFile={parsedFile}
          issues={issues}
          onDecide={decideIssue}
        />
      )}
      {currentStep === 'preview' && parsedFile && (
        <PreviewStep
          destination={destination}
          parsedFile={parsedFile}
          issues={issues}
          validation={validation}
          executionMode={executionMode}
          backendProbe={backendProbe}
          backendProbeError={backendProbeError}
          onProbeBackend={probeBackend}
          onExecutionModeChange={setExecutionMode}
          onConfirm={() => {
            setStep('result')
            void simulateMigration()
          }}
        />
      )}
      {currentStep === 'result' && (
        <ResultStep
          result={result}
          progress={batchProgress}
          manifest={batchManifest}
          onStartOver={() => {
            startWorkflow(destination)
            navigate('/')
          }}
        />
      )}
    </MigrationWizard>
  )
}
