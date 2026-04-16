import X from 'lucide-react/dist/esm/icons/x.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import { lazy, Suspense, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { WorkspaceShell } from '@/components/chronicle/WorkspaceShell';

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  WorkflowSteps,
  WorkflowKeyboardHints,
  useWorkflowKeyboard,
} from "@/components/ui/workflow-steps";
import { useWardRoundWorkflow } from "@/hooks/useWardRoundWorkflow";
import { PatientReviewStep } from "./ward-round-steps/PatientReviewStep";
import { TreatmentPlanStep } from "./ward-round-steps/TreatmentPlanStep";
import { DocumentationStep } from "./ward-round-steps/DocumentationStep";
import { toast } from "sonner";

/**
 * Step components mapped by ID
 */
const ClinicalAssessmentStep = lazy(() =>
  import("./ward-round-steps/ClinicalAssessmentStep").then((module) => ({
    default: module.ClinicalAssessmentStep,
  }))
);

const STEP_COMPONENTS = {
  patient_review: PatientReviewStep,
  clinical_assessment: ClinicalAssessmentStep,
  plan: TreatmentPlanStep,
  documentation: DocumentationStep,
};

/**
 * WardRoundSlideOver - Split-screen panel for ward round workflow
 *
 * Features:
 * - Slides in from right without backdrop (timeline remains visible)
 * - 4-step workflow: Patient Review → Clinical Assessment → Treatment Plan → Documentation
 * - Inline ordering for medications, labs, nursing orders
 * - Auto-save indicator
 * - Step progress visualization with keyboard navigation
 * - URL-driven state (can be linked directly)
 */
const WardRoundSlideOver = ({
  open,
  onClose,
  patient,
  admission,
  onComplete,
}) => {
  // Get patient and admission IDs
  const patientId = patient?.local_data?.id || patient?.id;
  const admissionId = admission?.id || patient?.local_data?.current_admission_id || patient?.current_admission_id;

  // Use the ward round workflow hook
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
  } = useWardRoundWorkflow(patientId, admissionId);

  // Start workflow when slide-over opens
  useEffect(() => {
    if (open && patientId && admissionId && !workflowId && !isLoading) {
      startWorkflow();
    }
  }, [open, patientId, admissionId, workflowId, isLoading, startWorkflow]);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      resetWorkflow();
    }
  }, [open, resetWorkflow]);

  // Handle step data change
  const handleStepDataChange = useCallback((data) => {
    if (currentStepConfig?.id) {
      updateStepData(currentStepConfig.id, data);
    }
  }, [currentStepConfig?.id, updateStepData]);

  // Navigation handlers
  const handleBack = () => {
    if (currentStep > 1) {
      prevStep();
    }
  };

  const handleNext = async () => {
    const success = await nextStep();
    if (!success) {
      toast.error("Please fix the errors before continuing");
    }
  };

  const handleSaveDraft = async () => {
    await saveDraft();
    toast.success("Draft saved");
  };

  const handleComplete = async () => {
    try {
      const result = await completeWorkflow();
      if (result?.success || result?.note_id) {
        toast.success("Ward round completed successfully");
        resetWorkflow();
        onComplete?.();
        onClose();
      }
    } catch (err) {
      console.error("Failed to complete ward round:", err);
      toast.error("Failed to complete ward round");
    }
  };

  const handleClose = () => {
    if (workflowId) {
      // Save draft before closing
      saveDraft();
    }
    resetWorkflow();
    onClose();
  };

  // Keyboard navigation
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

  // Get patient display name
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ""} ${patient.local_data.user_details.last_name || ""}`.trim()
    : patient?.full_name || patient?.name || "Patient";

  // Get current step component
  const CurrentStepComponent = currentStepConfig?.id
    ? STEP_COMPONENTS[currentStepConfig.id]
    : null;

  // Missing admission check
  if (open && !admissionId) {
    return (
      <WorkspaceShell open={open}>
        <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
          <h2 className="font-display text-xl text-foreground">Ward Round</h2>
          <Button
            variant="destructive"
            size="sm"
            onClick={onClose}
            className="font-mono text-xs"
          >
            <X className="h-4 w-4 mr-1.5" />
            Close
          </Button>
        </header>
        <div className="flex-1 flex items-center justify-center p-6">
          <Alert variant="destructive" className="max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Active admission required</strong>
              <p className="mt-1 text-sm">
                Ward rounds can only be performed for patients with an active admission.
                This patient does not have an active admission.
              </p>
            </AlertDescription>
          </Alert>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell open={open}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                Ward Round
              </span>
              <h2 className="font-display text-xl text-foreground">
                {currentStepConfig?.title || "Ward Round"}
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
          {/* Auto-save indicator */}
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

          {/* Close Button */}
          <Button
            variant="destructive"
            size="sm"
            onClick={handleClose}
            className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
          >
            <X className="h-4 w-4 mr-1.5" />
            Close
          </Button>
        </div>
      </header>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive" className="mx-6 mt-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Step Progress */}
      {workflowId && steps.length > 0 && currentStep > 0 && (
        <div className="px-6 py-3 bg-muted/30 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Stethoscope className="h-4 w-4 text-muted-foreground" />
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
            onStepClick={goToStep}
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
        {isLoading && !workflowId ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">Starting ward round...</p>
            </div>
          </div>
        ) : CurrentStepComponent ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12">
                <p className="text-sm text-muted-foreground">Loading step...</p>
              </div>
            }
          >
            <CurrentStepComponent
              formData={formData[currentStepConfig.id] || {}}
              onChange={handleStepDataChange}
              contextData={contextData}
              validationErrors={validationErrors}
              patientId={patientId}
              allFormData={formData}
            />
          </Suspense>
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {isLoading ? "Loading..." : "Unable to load workflow step."}
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
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
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save Draft
            </Button>

            <div className="flex items-center gap-2">
              {currentStep > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBack}
                  disabled={isLoading}
                  className="font-mono text-xs"
                >
                  <ChevronLeft className="h-3.5 w-3.5 mr-1" />
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
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  {isCompleting ? "Completing..." : "Complete Ward Round"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleNext}
                  disabled={isLoading}
                  className="font-mono text-xs"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              )}
            </div>
          </div>
        </footer>
      )}
    </WorkspaceShell>
  );
};

export default WardRoundSlideOver;
export { WardRoundSlideOver };
