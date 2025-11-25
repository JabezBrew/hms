import { useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { X, ChevronLeft, ChevronRight, Save, Check, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import NoteTypeSelector from "./NoteTypeSelector";
import NoteWorkflowSteps from "./NoteWorkflowSteps";
import DynamicWorkflowStep from "./DynamicWorkflowStep";
import { useNoteWorkflow } from "@/hooks/useNoteWorkflow";

// Category color mapping
const CATEGORY_COLORS = {
  general: 'amber',
  soap: 'amber',
  progress: 'amber',
  procedure: 'rose',
  admission: 'emerald',
  discharge: 'emerald',
  nursing: 'sky',
  consultation: 'amber',
  custom: 'violet',
};

/**
 * AddNoteSlideOver - Split-screen panel for creating clinical notes
 *
 * Features:
 * - Slides in from right without backdrop (timeline remains visible)
 * - Template-based note type selection
 * - Multi-step workflow derived from template structure
 * - Auto-save indicator
 * - Step progress visualization
 * - Backend API integration via useNoteWorkflow hook
 */
const AddNoteSlideOver = ({
  open,
  onClose,
  patient,
  onNoteCreated
}) => {
  // Get patient ID for the workflow hook
  const patientId = patient?.local_data?.id || patient?.id;

  // Use the template-driven workflow hook
  const {
    workflowId,
    template,
    steps,
    totalSteps,
    currentStep,
    formData,
    isSaving,
    lastSaved,
    error,
    isLoading,
    startWorkflow,
    updateStepData,
    saveDraft,
    nextStep,
    prevStep,
    completeWorkflow,
    resetWorkflow,
  } = useNoteWorkflow(patientId);

  // Computed values
  const isLastStep = currentStep === totalSteps;
  const currentStepConfig = steps[currentStep - 1] || null;
  const categoryColor = CATEGORY_COLORS[template?.category] || 'amber';

  // Handle template selection
  const handleSelectTemplate = async (selectedTemplate) => {
    await startWorkflow(selectedTemplate);
  };

  // Handle step data update
  const handleStepDataChange = useCallback((stepId, data) => {
    updateStepData(stepId, data);
  }, [updateStepData]);

  // Navigation handlers
  const handleBack = () => {
    if (currentStep > 1) {
      prevStep();
    } else {
      // Go back to template selection
      resetWorkflow();
    }
  };

  const handleNext = async () => {
    await nextStep();
  };

  const handleSaveDraft = async () => {
    await saveDraft();
  };

  const handleComplete = async () => {
    try {
      const result = await completeWorkflow();
      if (result?.success || result?.note) {
        resetWorkflow();
        onNoteCreated?.();
        onClose();
      }
    } catch (err) {
      console.error('Failed to complete note:', err);
    }
  };

  const handleClose = () => {
    resetWorkflow();
    onClose();
  };

  // Reset state when panel closes
  useEffect(() => {
    if (!open) {
      resetWorkflow();
    }
  }, [open, resetWorkflow]);

  // Get patient display name
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.name || 'Patient';

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
              {template && (
                <span className={cn(
                  "px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wider",
                  categoryColor === 'amber' && "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
                  categoryColor === 'rose' && "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
                  categoryColor === 'sky' && "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
                  categoryColor === 'emerald' && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
                  categoryColor === 'violet' && "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400"
                )}>
                  {template.title}
                </span>
              )}
              <h2 className="font-display text-xl text-foreground">
                {template ? 'New Note' : 'Add Note'}
              </h2>
            </div>
            <p className="font-mono text-xs text-muted-foreground mt-0.5">
              {patientName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Auto-save indicator */}
          {template && (
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

      {/* Error Alert with back option */}
      {error && (
        <Alert variant="destructive" className="mx-6 mt-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            {template && (
              <Button
                variant="outline"
                size="sm"
                onClick={resetWorkflow}
                className="ml-4 font-mono text-xs"
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                Back
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Step Progress - show when template selected and has steps */}
      {template && steps.length > 0 && currentStep > 0 && (
        <div className="px-6 py-3 bg-muted/30 border-b border-border">
          {/* Change Note Type Link */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={resetWorkflow}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors font-mono text-xs"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Change Note Type
            </button>
            <span className="font-mono text-xs text-muted-foreground">
              Step {currentStep} of {totalSteps}
            </span>
          </div>
          {/* Step Progress Indicators */}
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={cn(
                  "flex items-center",
                  index < steps.length - 1 && "flex-1"
                )}
              >
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono",
                    index < currentStep - 1 && "bg-primary text-primary-foreground",
                    index === currentStep - 1 && "bg-primary text-primary-foreground ring-2 ring-primary/30",
                    index > currentStep - 1 && "bg-muted text-muted-foreground"
                  )}>
                    {index < currentStep - 1 ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      index + 1
                    )}
                  </div>
                  <span className={cn(
                    "font-mono text-xs hidden sm:inline truncate max-w-[80px]",
                    index === currentStep - 1 ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {step.title}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div className={cn(
                    "flex-1 h-px mx-3",
                    index < currentStep - 1 ? "bg-primary" : "bg-border"
                  )} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
        {!template ? (
          <NoteTypeSelector onSelect={handleSelectTemplate} />
        ) : currentStepConfig ? (
          <DynamicWorkflowStep
            stepConfig={currentStepConfig}
            formData={formData[currentStepConfig.id] || {}}
            onDataChange={(data) => handleStepDataChange(currentStepConfig.id, data)}
            patient={patient}
            template={template}
          />
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">
              {isLoading ? 'Loading step...' : 'Unable to load workflow step.'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={resetWorkflow}
              className="font-mono text-xs"
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              Back to Templates
            </Button>
          </div>
        )}
      </div>

      {/* Footer */}
      {template && (
        <footer className="px-6 py-4 border-t border-border bg-card">
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
                  disabled={isSaving || isLoading}
                  className="font-mono text-xs"
                >
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Complete Note
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

export default AddNoteSlideOver;
export { AddNoteSlideOver };
