import X from 'lucide-react/dist/esm/icons/x.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { WorkflowSteps, WorkflowKeyboardHints } from "@/components/ui/workflow-steps";
import { PatientReviewStep } from "./consultation-steps/PatientReviewStep";
import { HistoryExamStep } from "./consultation-steps/HistoryExamStep";
import { AssessmentPlanStep } from "./consultation-steps/AssessmentPlanStep";

const STEP_COMPONENTS = {
  patient_review: PatientReviewStep,
  history_exam: HistoryExamStep,
  assessment_plan: AssessmentPlanStep,
};

function ConsultationHeader({
  currentStepConfig,
  contextData,
  isLoading,
  isSaving,
  lastSaved,
  onClose,
  patientName,
  workflowId,
}) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wider bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400">
              Consultation
            </span>
            <h2 className="font-display text-xl text-foreground">
              {currentStepConfig?.title || "Consultation"}
            </h2>
          </div>
          <p className="font-mono text-xs text-muted-foreground mt-0.5">
            {patientName}
            {contextData?.prep_data?.medical_record_number && (
              <span className="ml-2">
                · MRN: {contextData.prep_data.medical_record_number}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {workflowId && (
          <span className="font-mono text-xs text-muted-foreground">
            {isSaving || isLoading ? (
              "Saving..."
            ) : lastSaved ? (
              `Saved ${lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            ) : (
              "Draft"
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

function ConsultationProgress({
  contextData,
  currentStep,
  goToStep,
  steps,
  totalSteps,
  workflowId,
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
            {contextData?.prep_data?.referral
              ? `Referral: ${contextData.prep_data.referral.referral_number}`
              : "New Consultation"}
          </span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          Step {currentStep} of {totalSteps}
        </span>
      </div>
      <WorkflowSteps
        steps={steps}
        currentStep={currentStep}
        onStepClick={goToStep}
      />
    </div>
  );
}

function ConsultationContent({
  contextData,
  currentStepConfig,
  formData,
  isLoading,
  onStepDataChange,
  patientId,
  validationErrors,
  workflowId,
}) {
  const CurrentStepComponent = currentStepConfig?.id
    ? STEP_COMPONENTS[currentStepConfig.id]
    : null;

  return (
    <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
      {isLoading && !workflowId ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <LoadingSpinner className="mx-auto mb-4 h-8 w-16 text-primary" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Starting consultation…</p>
          </div>
        </div>
      ) : CurrentStepComponent ? (
        <CurrentStepComponent
          formData={formData[currentStepConfig.id] || {}}
          onChange={onStepDataChange}
          contextData={contextData}
          validationErrors={validationErrors}
          patientId={patientId}
          allFormData={formData}
        />
      ) : (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {isLoading ? "Loading..." : "Unable to load workflow step."}
          </p>
        </div>
      )}
    </div>
  );
}

function ConsultationFooter({
  currentStep,
  onBack,
  onComplete,
  onNext,
  onSaveDraft,
  totalSteps,
  workflowStatus,
  workflowId,
}) {
  if (!workflowId) {
    return null;
  }

  const { isCompleting, isLastStep, isLoading, isSaving } = workflowStatus;

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
              {isCompleting ? "Completing..." : "Complete Consultation"}
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

export function ConsultationSlideOverPanel({
  contextData,
  currentStep,
  currentStepConfig,
  error,
  formData,
  goToStep,
  lastSaved,
  onBack,
  onClose,
  onComplete,
  onNext,
  onSaveDraft,
  onStepDataChange,
  open,
  patientId,
  patientName,
  steps,
  totalSteps,
  validationErrors,
  workflowStatus,
  workflowId,
}) {
  const { isCompleting, isLastStep, isLoading, isSaving } = workflowStatus;

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col shadow-2xl",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      <ConsultationHeader
        currentStepConfig={currentStepConfig}
        contextData={contextData}
        isLoading={isLoading}
        isSaving={isSaving}
        lastSaved={lastSaved}
        onClose={onClose}
        patientName={patientName}
        workflowId={workflowId}
      />

      {error && (
        <Alert variant="destructive" className="mx-6 mt-4">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ConsultationProgress
        contextData={contextData}
        currentStep={currentStep}
        goToStep={goToStep}
        steps={steps}
        totalSteps={totalSteps}
        workflowId={workflowId}
      />

      <ConsultationContent
        contextData={contextData}
        currentStepConfig={currentStepConfig}
        formData={formData}
        isLoading={isLoading}
        onStepDataChange={onStepDataChange}
        patientId={patientId}
        validationErrors={validationErrors}
        workflowId={workflowId}
      />

      <ConsultationFooter
        currentStep={currentStep}
        onBack={onBack}
        onComplete={onComplete}
        onNext={onNext}
        onSaveDraft={onSaveDraft}
        totalSteps={totalSteps}
        workflowStatus={{ isCompleting, isLastStep, isLoading, isSaving }}
        workflowId={workflowId}
      />
    </div>
  );
}
