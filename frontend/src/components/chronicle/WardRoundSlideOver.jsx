import { lazy, useCallback, useEffect } from "react";
import {
  useWorkflowKeyboard,
} from "@/components/ui/workflow-steps";
import { useWardRoundWorkflow } from "@/hooks/useWardRoundWorkflow";
import { PatientReviewStep } from "./ward-round-steps/PatientReviewStep";
import { TreatmentPlanStep } from "./ward-round-steps/TreatmentPlanStep";
import { DocumentationStep } from "./ward-round-steps/DocumentationStep";
import { toast } from "sonner";
import {
  WardRoundContent,
  WardRoundError,
  WardRoundFooter,
  WardRoundHeader,
  WardRoundMissingAdmission,
  WardRoundPanel,
  WardRoundProgress,
} from "./WardRoundSlideOverSections";

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
  // Get patient and admission IDs. These are pure PatientChroniclePage prop
  // projections; the controlled-open side effect is documented below.
  // react-doctor-disable-next-line react-doctor/no-event-handler
  const patientId = patient?.local_data?.id || patient?.id;
  // react-doctor-disable-next-line react-doctor/no-event-handler
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

  // PatientChroniclePage owns the open event; this synchronizes the controlled
  // panel state with the backend workflow draft when the panel is externally opened.
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-event-handler
    if (open && patientId && admissionId && !workflowId && !isLoading) {
      startWorkflow();
    }
  }, [open, patientId, admissionId, workflowId, isLoading, startWorkflow]);

  // Parent routing and outside controls can close the panel without using this
  // component's Close button, so reset the local draft when controlled open turns false.
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-event-handler
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
      <WardRoundMissingAdmission open={open} onClose={onClose} />
    );
  }

  return (
    <WardRoundPanel open={open}>
      <WardRoundHeader
        title={currentStepConfig?.title}
        patientName={patientName}
        contextData={contextData}
        workflowId={workflowId}
        isSaving={isSaving}
        isLoading={isLoading}
        lastSaved={lastSaved}
        onClose={handleClose}
      />
      <WardRoundError error={error} />
      <WardRoundProgress
        workflowId={workflowId}
        steps={steps}
        currentStep={currentStep}
        totalSteps={totalSteps}
        contextData={contextData}
        onStepClick={goToStep}
      />
      <WardRoundContent
        isLoading={isLoading}
        workflowId={workflowId}
        currentStepConfig={currentStepConfig}
        CurrentStepComponent={CurrentStepComponent}
        formData={formData}
        onStepDataChange={handleStepDataChange}
        contextData={contextData}
        validationErrors={validationErrors}
        patientId={patientId}
      />
      <WardRoundFooter
        workflowId={workflowId}
        totalSteps={totalSteps}
        currentStep={currentStep}
        navigationState={{ isLastStep, isSaving, isLoading, isCompleting }}
        onSaveDraft={handleSaveDraft}
        onBack={handleBack}
        onNext={handleNext}
        onComplete={handleComplete}
      />
    </WardRoundPanel>
  );
};

export default WardRoundSlideOver;
export { WardRoundSlideOver };
