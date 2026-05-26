import X from 'lucide-react/dist/esm/icons/x.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import LogOut from 'lucide-react/dist/esm/icons/log-out.js';
import { useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  WorkflowSteps,
  WorkflowKeyboardHints,
  useWorkflowKeyboard,
} from '@/components/ui/workflow-steps';
import { useDischargeWorkflow } from '@/hooks/useDischargeWorkflow';
import { DischargePlanningStep } from './discharge-steps/DischargePlanningStep';
import { DischargeMedicationsStep } from './discharge-steps/DischargeMedicationsStep';
import { DischargeInstructionsStep } from './discharge-steps/DischargeInstructionsStep';
import { DischargeSummaryStep } from './discharge-steps/DischargeSummaryStep';
import { toast } from 'sonner';

const STEP_COMPONENTS = {
  discharge_planning: DischargePlanningStep,
  medications: DischargeMedicationsStep,
  instructions: DischargeInstructionsStep,
  documentation: DischargeSummaryStep,
};

const DischargeSlideOver = ({ open, onClose, patient, admission, onComplete }) => {
  const patientId = patient?.local_data?.id || patient?.id;
  const admissionId = admission?.id || patient?.local_data?.current_admission_id || patient?.current_admission_id;

  const {
    workflowId,
    steps,
    totalSteps,
    currentStep,
    currentStepConfig,
    formData,
    contextData,
    isSaving,
    lastSaved,
    error,
    validationErrors,
    isLastStep,
    isLoading,
    isCompleting,
    startWorkflow,
    updateStepData,
    saveDraft,
    nextStep,
    prevStep,
    goToStep,
    completeWorkflow,
    resetWorkflow,
  } = useDischargeWorkflow(patientId, admissionId);

  useEffect(() => {
    if (open && patientId && admissionId && !workflowId && !isLoading) {
      startWorkflow();
    }
  }, [open, patientId, admissionId, workflowId, isLoading, startWorkflow]);

  useEffect(() => {
    if (!open) {
      resetWorkflow();
    }
  }, [open, resetWorkflow]);

  const handleStepDataChange = useCallback((data) => {
    if (!currentStepConfig?.id) return;
    updateStepData(currentStepConfig.id, data);
  }, [currentStepConfig?.id, updateStepData]);

  const handleSaveDraft = async () => {
    await saveDraft();
    toast.success('Draft saved');
  };

  const handleNext = async () => {
    const success = await nextStep();
    if (!success) {
      toast.error('Please fix the errors before continuing');
    }
  };

  const handleComplete = async () => {
    const result = await completeWorkflow();
    if (result?.success) {
      toast.success('Medical discharge submitted for clearance');
      resetWorkflow();
      onComplete?.(result);
      onClose();
    }
  };

  const handleClose = () => {
    if (workflowId) {
      void saveDraft();
    }
    resetWorkflow();
    onClose();
  };

  useWorkflowKeyboard({
    enabled: open && !!workflowId,
    currentStep,
    totalSteps,
    onNextStep: nextStep,
    onPrevStep: prevStep,
    onGoToStep: goToStep,
    onComplete: completeWorkflow,
    onClose: handleClose,
  });

  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.full_name || patient?.name || 'Patient';

  const CurrentStepComponent = currentStepConfig?.id
    ? STEP_COMPONENTS[currentStepConfig.id]
    : null;

  if (open && !admissionId) {
    return (
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border',
          'transform transition-transform duration-300 ease-in-out',
          'flex flex-col shadow-2xl',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
          <h2 className="font-display text-xl text-foreground">Medical Discharge</h2>
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
                Medical discharge can only be started for patients with an active inpatient stay.
              </p>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border',
        'transform transition-transform duration-300 ease-in-out',
        'flex flex-col shadow-2xl',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
              Medical Discharge
            </span>
            <h2 className="font-display text-xl text-foreground">
              {currentStepConfig?.title || 'Medical Discharge'}
            </h2>
          </div>
          <p className="font-mono text-xs text-muted-foreground mt-0.5">
            {patientName}
            {contextData?.ward_name && (
              <span className="ml-2">· {contextData.ward_name}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {workflowId && (
            <span className="font-mono text-xs text-muted-foreground">
              {isSaving || isLoading
                ? 'Saving...'
                : lastSaved
                  ? `Saved ${lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Draft'}
            </span>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={handleClose}
            className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
          >
            <X className="size-4 mr-1.5" />
            Close
          </Button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="mx-6 mt-4">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {workflowId && steps.length > 0 && currentStep > 0 && (
        <div className="px-6 py-3 bg-muted/30 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <LogOut className="size-4 text-muted-foreground" />
              <span className="font-mono text-xs text-muted-foreground">
                Step {currentStep} of {totalSteps}
              </span>
            </div>
          </div>
          <WorkflowSteps
            steps={steps}
            currentStep={currentStep}
            onStepClick={goToStep}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
        {isLoading && !workflowId ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full size-8 border-b-2 border-primary mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">Starting medical discharge workflow…</p>
            </div>
          </div>
        ) : CurrentStepComponent ? (
          <CurrentStepComponent
            formData={formData[currentStepConfig.id] || {}}
            onChange={handleStepDataChange}
            contextData={contextData}
            validationErrors={validationErrors}
            allFormData={formData}
          />
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {isLoading ? 'Loading...' : 'Unable to load workflow step.'}
            </p>
          </div>
        )}
      </div>

      {workflowId && (
        <footer className="px-6 py-3 border-t border-border bg-card">
          <WorkflowKeyboardHints totalSteps={totalSteps} className="mb-3" />
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveDraft}
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
                  onClick={prevStep}
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
                  onClick={handleComplete}
                  disabled={isSaving || isLoading || isCompleting}
                  className="font-mono text-xs"
                >
                  <Check className="size-3.5 mr-1.5" />
                  {isCompleting ? 'Submitting...' : 'Submit for Clearance'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleNext}
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
      )}
    </div>
  );
};

export default DischargeSlideOver;
export { DischargeSlideOver };
