import { useCallback, useEffect, useRef } from "react";

import { useWorkflowKeyboard } from "@/components/ui/workflow-steps";
import { ConsultationSlideOverPanel } from "./ConsultationSlideOverSections";
import { useConsultationWorkflow } from "@/hooks/useConsultationWorkflow";
import { useVisit, useVisitActions } from "@/hooks/useVisitQueries";
import { toast } from "sonner";

const AUTO_START_VISIT_STATUSES = new Set([
  "checked_in",
  "waiting",
  "called",
  "on_hold",
]);

const TERMINAL_VISIT_STATUSES = new Set([
  "checked_out",
  "no_show",
  "cancelled",
]);

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
  encounterId,
  onComplete,
}) => {
  // Get patient ID
  const patientId = patient?.local_data?.id || patient?.id;
  const initializedRef = useRef(null);
  const { data: visit, isLoading: isVisitLoading } = useVisit(encounterId, {
    enabled: open && Boolean(encounterId),
  });
  const { startConsultation, endConsultation } = useVisitActions();

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
  } = useConsultationWorkflow(patientId, { referralId, appointmentId, encounterId });

  // Start workflow when slide-over opens
  useEffect(() => {
    if (!open) {
      initializedRef.current = null;
      return;
    }

    const initKey = `${patientId || "unknown"}:${encounterId || "none"}`;
    if (!patientId || workflowId || isLoading || initializedRef.current === initKey) {
      return;
    }
    if (encounterId && isVisitLoading) {
      return;
    }

    let cancelled = false;

    const initializeWorkflow = async () => {
      initializedRef.current = initKey;

      try {
        if (encounterId && AUTO_START_VISIT_STATUSES.has(visit?.visit_status)) {
          await startConsultation.mutateAsync(encounterId);
        }

        const workflow = await startWorkflow();
        if (!workflow && !cancelled) {
          initializedRef.current = null;
        }
      } catch (err) {
        if (!cancelled) {
          initializedRef.current = null;
          toast.error(err?.message || "Failed to start consultation");
        }
      }
    };

    initializeWorkflow();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    patientId,
    encounterId,
    workflowId,
    isLoading,
    isVisitLoading,
    visit?.visit_status,
    startConsultation,
    startWorkflow,
  ]);

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
      if (result?.success || result?.note_id || result?.encounter_id) {
        const currentVisitStatus = visit?.visit_status;
        if (
          encounterId
          && !TERMINAL_VISIT_STATUSES.has(currentVisitStatus)
          && currentVisitStatus !== "ready_checkout"
        ) {
          try {
            await endConsultation.mutateAsync(encounterId);
          } catch (visitError) {
            const message = visitError?.message || "";
            if (
              !message.includes("ready_checkout")
              && !message.includes("checked_out")
              && !message.includes("no_show")
            ) {
              throw visitError;
            }
          }
        }
        toast.success(
          encounterId
            ? "Consultation completed. Patient is ready for checkout."
            : "Consultation completed successfully"
        );
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
    onComplete: handleComplete,
    onClose: handleClose,
  });

  // Get patient display name
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ""} ${patient.local_data.user_details.last_name || ""}`.trim()
    : patient?.full_name || patient?.name || "Patient";

  return (
    <ConsultationSlideOverPanel
      contextData={contextData}
      currentStep={currentStep}
      currentStepConfig={currentStepConfig}
      error={error}
      formData={formData}
      goToStep={goToStep}
      lastSaved={lastSaved}
      onBack={handleBack}
      onClose={handleClose}
      onComplete={handleComplete}
      onNext={handleNext}
      onSaveDraft={handleSaveDraft}
      onStepDataChange={handleStepDataChange}
      open={open}
      patientId={patientId}
      patientName={patientName}
      steps={steps}
      totalSteps={totalSteps}
      validationErrors={validationErrors}
      workflowStatus={{ isCompleting, isLastStep, isLoading, isSaving }}
      workflowId={workflowId}
    />
  );
};

export default ConsultationSlideOver;
export { ConsultationSlideOver };
