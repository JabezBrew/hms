import { useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { X, ChevronLeft, ChevronRight, Save, Check, AlertCircle, Stethoscope } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  WorkflowSteps,
  WorkflowKeyboardHints,
  useWorkflowKeyboard,
} from "@/components/ui/workflow-steps";
import { useConsultationWorkflow } from "@/hooks/useConsultationWorkflow";
import {
  PatientReviewStep,
  HistoryExamStep,
  AssessmentPlanStep,
} from "./consultation-steps";
import { toast } from "sonner";

/**
 * Step components mapped by ID
 */
const STEP_COMPONENTS = {
  patient_review: PatientReviewStep,
  history_exam: HistoryExamStep,
  assessment_plan: AssessmentPlanStep,
};

/**
 * ConsultationSlideOver - Split-screen panel for consultation workflow
 *
 * Features:
 * - Slides in from right without backdrop (timeline remains visible)
 * - 3-step workflow: Patient Review → History & Exam → Assessment & Plan
 * - Auto-save indicator
 * - Step progress visualization with keyboard navigation
 * - URL-driven state (can be linked directly)
 */
const ConsultationSlideOver = ({
  open,
  onClose,
  patient,
  referralId,
  appointmentId,
  onComplete,
}) => {
  // Get patient ID
  const patientId = patient?.local_data?.id || patient?.id;

  // Use the consultation workflow hook
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
    setError,
  } = useConsultationWorkflow(patientId, { referralId, appointmentId });

  // Start workflow when slide-over opens
  useEffect(() => {
    if (open && patientId && !workflowId && !isLoading) {
      startWorkflow();
    }
  }, [open, patientId, workflowId, isLoading, startWorkflow]);

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
      if (result?.success || result?.note_id || result?.encounter_id) {
        toast.success("Consultation completed successfully");
        resetWorkflow();
        onComplete?.();
        onClose();
      }
    } catch (err) {
      console.error("Failed to complete consultation:", err);
      toast.error("Failed to complete consultation");
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

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col shadow-2xl",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      {/* Header */}
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
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
        {isLoading && !workflowId ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">Starting consultation...</p>
            </div>
          </div>
        ) : CurrentStepComponent ? (
          <CurrentStepComponent
            formData={formData[currentStepConfig.id] || {}}
            onChange={handleStepDataChange}
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
                  {isCompleting ? "Completing..." : "Complete Consultation"}
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
    </div>
  );
};

export default ConsultationSlideOver;
export { ConsultationSlideOver };
