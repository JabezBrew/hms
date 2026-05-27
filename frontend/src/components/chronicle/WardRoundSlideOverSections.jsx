import X from 'lucide-react/dist/esm/icons/x.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import { Suspense } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { WorkflowKeyboardHints, WorkflowSteps } from '@/components/ui/workflow-steps';

export function WardRoundPanel({ open, children }) {
  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border',
        'transform transition-transform duration-300 ease-in-out',
        'flex flex-col shadow-2xl',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {children}
    </div>
  );
}

export function WardRoundMissingAdmission({ open, onClose }) {
  return (
    <WardRoundPanel open={open}>
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <h2 className="font-display text-xl text-foreground">Ward Round</h2>
        <Button
          variant="destructive"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs"
        >
          <X className="size-4 mr-1.5" />
          Close
        </Button>
      </header>
      <div className="flex-1 flex items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="size-4" />
          <AlertDescription>
            <strong>Active admission required</strong>
            <p className="mt-1 text-sm">
              Ward rounds can only be performed for patients with an active admission.
              This patient does not have an active admission.
            </p>
          </AlertDescription>
        </Alert>
      </div>
    </WardRoundPanel>
  );
}

export function WardRoundHeader({
  title,
  patientName,
  contextData,
  workflowId,
  isSaving,
  isLoading,
  lastSaved,
  onClose,
}) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
              Ward Round
            </span>
            <h2 className="font-display text-xl text-foreground">
              {title || 'Ward Round'}
            </h2>
          </div>
          <p className="font-mono text-xs text-muted-foreground mt-0.5">
            {patientName}
            {contextData?.ward_name && (
              <span className="ml-2">
                · {contextData.ward_name} - Bed {contextData.bed_number}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {workflowId && (
          <span className="font-mono text-xs text-muted-foreground">
            {isSaving || isLoading ? (
              'Saving...'
            ) : lastSaved ? (
              `Saved ${lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            ) : (
              'Draft'
            )}
          </span>
        )}

        <Button
          variant="destructive"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
        >
          <X className="size-4 mr-1.5" />
          Close
        </Button>
      </div>
    </header>
  );
}

export function WardRoundError({ error }) {
  if (!error) return null;

  return (
    <Alert variant="destructive" className="mx-6 mt-4">
      <AlertCircle className="size-4" />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

export function WardRoundProgress({
  workflowId,
  steps,
  currentStep,
  totalSteps,
  contextData,
  onStepClick,
}) {
  if (!workflowId || steps.length === 0 || currentStep <= 0) {
    return null;
  }

  return (
    <div className="px-6 py-3 bg-muted/30 border-b border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Stethoscope className="size-4 text-muted-foreground" />
          <span className="font-mono text-xs text-muted-foreground">
            Day {contextData?.prep_data?.admission_days || 0} of admission
          </span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          Step {currentStep} of {totalSteps}
        </span>
      </div>
      <WorkflowSteps
        steps={steps}
        currentStep={currentStep}
        onStepClick={onStepClick}
      />
    </div>
  );
}

export function WardRoundContent({
  isLoading,
  workflowId,
  currentStepConfig,
  CurrentStepComponent,
  formData,
  onStepDataChange,
  contextData,
  validationErrors,
  patientId,
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
      {isLoading && !workflowId ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full size-8 border-b-2 border-primary mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Starting ward round…</p>
          </div>
        </div>
      ) : CurrentStepComponent ? (
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">Loading step…</p>
            </div>
          }
        >
          <CurrentStepComponent
            formData={formData[currentStepConfig.id] || {}}
            onChange={onStepDataChange}
            contextData={contextData}
            validationErrors={validationErrors}
            patientId={patientId}
            allFormData={formData}
          />
        </Suspense>
      ) : (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {isLoading ? 'Loading...' : 'Unable to load workflow step.'}
          </p>
        </div>
      )}
    </div>
  );
}

export function WardRoundFooter({
  workflowId,
  totalSteps,
  currentStep,
  navigationState,
  onSaveDraft,
  onBack,
  onNext,
  onComplete,
}) {
  if (!workflowId) return null;

  const { isLastStep, isSaving, isLoading, isCompleting } = navigationState;

  return (
    <footer className="px-6 py-3 border-t border-border bg-card">
      <WorkflowKeyboardHints totalSteps={totalSteps} className="mb-3" />

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={onSaveDraft}
          disabled={isSaving || isLoading}
          className="font-mono text-xs"
        >
          <Save className="size-3.5 mr-1.5" />
          Save Draft
        </Button>

        <div className="flex items-center gap-2">
          {currentStep > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onBack}
              disabled={isLoading}
              className="font-mono text-xs"
            >
              <ChevronLeft className="size-3.5 mr-1" />
              Previous
            </Button>
          )}

          {isLastStep ? (
            <Button
              size="sm"
              onClick={onComplete}
              disabled={isSaving || isLoading || isCompleting}
              className="font-mono text-xs"
            >
              <Check className="size-3.5 mr-1.5" />
              {isCompleting ? 'Completing...' : 'Complete Ward Round'}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onNext}
              disabled={isLoading}
              className="font-mono text-xs"
            >
              Next
              <ChevronRight className="size-3.5 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </footer>
  );
}
