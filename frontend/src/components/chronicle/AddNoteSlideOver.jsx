import { useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { X, ChevronLeft, ChevronRight, Save, Check, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import NoteTypeSelector from "./NoteTypeSelector";
import NoteWorkflowSteps from "./NoteWorkflowSteps";
import { useNoteWorkflow } from "@/hooks/useNoteWorkflow";

/**
 * AddNoteSlideOver - Split-screen panel for creating clinical notes
 *
 * Features:
 * - Slides in from right without backdrop (timeline remains visible)
 * - Note type selection → multi-step workflow
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

  // Use the workflow hook for API integration
  const {
    workflowId,
    noteType: selectedNoteType,
    currentStep,
    formData,
    isSaving,
    lastSaved,
    error,
    isLoading,
    noteTypeConfigs,
    startWorkflow,
    updateStepData,
    saveDraft,
    nextStep,
    prevStep,
    completeWorkflow,
    resetWorkflow,
  } = useNoteWorkflow(patientId);

  // Local state for UI
  const [localSelectedNoteType, setLocalSelectedNoteType] = useState(null);
  const [localCurrentStep, setLocalCurrentStep] = useState(0);
  const [localFormData, setLocalFormData] = useState({});
  const [localIsSaving, setLocalIsSaving] = useState(false);
  const [localLastSaved, setLocalLastSaved] = useState(null);
  const [useBackendWorkflow, setUseBackendWorkflow] = useState(false);

  // Note type definitions with steps
  const noteTypes = {
    progress: {
      id: 'progress',
      name: 'Progress Note',
      color: 'amber',
      steps: [
        { id: 'chief_complaint', title: 'Chief Complaint' },
        { id: 'assessment', title: 'Assessment' },
        { id: 'plan', title: 'Plan' }
      ]
    },
    soap: {
      id: 'soap',
      name: 'SOAP Note',
      color: 'amber',
      steps: [
        { id: 'subjective', title: 'Subjective' },
        { id: 'objective', title: 'Objective' },
        { id: 'assessment', title: 'Assessment' },
        { id: 'plan', title: 'Plan' }
      ]
    },
    procedure: {
      id: 'procedure',
      name: 'Procedure Note',
      color: 'rose',
      steps: [
        { id: 'pre_procedure', title: 'Pre-Procedure' },
        { id: 'procedure_details', title: 'Procedure Details' },
        { id: 'post_procedure', title: 'Post-Procedure' }
      ]
    },
    phone: {
      id: 'phone',
      name: 'Phone Note',
      color: 'sky',
      steps: [
        { id: 'caller_info', title: 'Caller Info' },
        { id: 'discussion', title: 'Discussion' },
        { id: 'action_items', title: 'Action Items' }
      ]
    }
  };

  // Determine which state to use (backend workflow or local)
  const activeNoteType = useBackendWorkflow ? selectedNoteType : localSelectedNoteType;
  const activeCurrentStep = useBackendWorkflow ? (currentStep - 1) : localCurrentStep; // Backend uses 1-indexed
  const activeFormData = useBackendWorkflow ? formData : localFormData;
  const activeIsSaving = useBackendWorkflow ? isSaving : localIsSaving;
  const activeLastSaved = useBackendWorkflow ? lastSaved : localLastSaved;

  const currentNoteConfig = activeNoteType ? noteTypes[activeNoteType] : null;
  const totalSteps = currentNoteConfig?.steps?.length || 0;
  const isLastStep = activeCurrentStep === totalSteps - 1;

  // Handle note type selection
  const handleSelectNoteType = async (typeId) => {
    // Try to use backend workflow if patient ID is available
    if (patientId) {
      try {
        await startWorkflow(typeId);
        setUseBackendWorkflow(true);
        return;
      } catch (err) {
        console.warn('Backend workflow unavailable, using local state:', err);
      }
    }

    // Fall back to local state
    setUseBackendWorkflow(false);
    setLocalSelectedNoteType(typeId);
    setLocalCurrentStep(0);
    setLocalFormData({});
  };

  // Handle step data update
  const handleStepDataChange = useCallback((stepId, data) => {
    if (useBackendWorkflow) {
      updateStepData(stepId, data);
    } else {
      setLocalFormData(prev => ({
        ...prev,
        [stepId]: data
      }));
    }
  }, [useBackendWorkflow, updateStepData]);

  // Navigation handlers
  const handleBack = () => {
    if (useBackendWorkflow) {
      if (currentStep > 1) {
        prevStep();
      } else {
        // Go back to note type selection
        resetWorkflow();
        setUseBackendWorkflow(false);
      }
    } else {
      if (localCurrentStep > 0) {
        setLocalCurrentStep(prev => prev - 1);
      } else {
        // Go back to note type selection
        setLocalSelectedNoteType(null);
        setLocalFormData({});
      }
    }
  };

  const handleNext = async () => {
    if (useBackendWorkflow) {
      await nextStep();
    } else {
      if (localCurrentStep < totalSteps - 1) {
        setLocalCurrentStep(prev => prev + 1);
      }
    }
  };

  const handleSaveDraft = async () => {
    if (useBackendWorkflow) {
      await saveDraft();
    } else {
      setLocalIsSaving(true);
      // Simulate save
      await new Promise(resolve => setTimeout(resolve, 500));
      setLocalLastSaved(new Date());
      setLocalIsSaving(false);
    }
  };

  const handleComplete = async () => {
    if (useBackendWorkflow) {
      try {
        const result = await completeWorkflow();
        if (result?.success) {
          resetWorkflow();
          setUseBackendWorkflow(false);
          onNoteCreated?.();
          onClose();
        }
      } catch (err) {
        console.error('Failed to complete note:', err);
      }
    } else {
      setLocalIsSaving(true);
      try {
        // Simulate completion
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Reset local state
        setLocalSelectedNoteType(null);
        setLocalCurrentStep(0);
        setLocalFormData({});
        setLocalLastSaved(null);

        // Notify parent
        onNoteCreated?.();
        onClose();
      } catch (err) {
        console.error('Failed to complete note:', err);
      } finally {
        setLocalIsSaving(false);
      }
    }
  };

  const handleClose = () => {
    // Reset all state
    if (useBackendWorkflow) {
      resetWorkflow();
    }
    setLocalSelectedNoteType(null);
    setLocalCurrentStep(0);
    setLocalFormData({});
    setLocalLastSaved(null);
    setUseBackendWorkflow(false);
    onClose();
  };

  // Reset state when panel closes
  useEffect(() => {
    if (!open) {
      if (useBackendWorkflow) {
        resetWorkflow();
      }
      setLocalSelectedNoteType(null);
      setLocalCurrentStep(0);
      setLocalFormData({});
      setLocalLastSaved(null);
      setUseBackendWorkflow(false);
    }
  }, [open, useBackendWorkflow, resetWorkflow]);

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
              {currentNoteConfig && (
                <span className={cn(
                  "px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wider",
                  currentNoteConfig.color === 'amber' && "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
                  currentNoteConfig.color === 'rose' && "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
                  currentNoteConfig.color === 'sky' && "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400"
                )}>
                  {currentNoteConfig.name}
                </span>
              )}
              <h2 className="font-display text-xl text-foreground">
                {activeNoteType ? 'New Note' : 'Add Note'}
              </h2>
            </div>
            <p className="font-mono text-xs text-muted-foreground mt-0.5">
              {patientName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Auto-save indicator */}
          {activeNoteType && (
            <span className="font-mono text-xs text-muted-foreground">
              {activeIsSaving || isLoading ? (
                'Saving...'
              ) : activeLastSaved ? (
                `Saved ${activeLastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              ) : (
                'Draft'
              )}
            </span>
          )}

          {/* Close Button - More Prominent */}
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
      {activeNoteType && currentNoteConfig && (
        <div className="px-6 py-3 bg-muted/30 border-b border-border">
          {/* Change Note Type Link */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => {
                if (useBackendWorkflow) {
                  resetWorkflow();
                  setUseBackendWorkflow(false);
                } else {
                  setLocalSelectedNoteType(null);
                  setLocalCurrentStep(0);
                  setLocalFormData({});
                }
              }}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors font-mono text-xs"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Change Note Type
            </button>
            <span className="font-mono text-xs text-muted-foreground">
              Step {activeCurrentStep + 1} of {totalSteps}
            </span>
          </div>
          {/* Step Progress Indicators */}
          <div className="flex items-center justify-between">
            {currentNoteConfig.steps.map((step, index) => (
              <div
                key={step.id}
                className={cn(
                  "flex items-center",
                  index < currentNoteConfig.steps.length - 1 && "flex-1"
                )}
              >
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono",
                    index < activeCurrentStep && "bg-primary text-primary-foreground",
                    index === activeCurrentStep && "bg-primary text-primary-foreground ring-2 ring-primary/30",
                    index > activeCurrentStep && "bg-muted text-muted-foreground"
                  )}>
                    {index < activeCurrentStep ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      index + 1
                    )}
                  </div>
                  <span className={cn(
                    "font-mono text-xs hidden sm:inline",
                    index === activeCurrentStep ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {step.title}
                  </span>
                </div>
                {index < currentNoteConfig.steps.length - 1 && (
                  <div className={cn(
                    "flex-1 h-px mx-3",
                    index < activeCurrentStep ? "bg-primary" : "bg-border"
                  )} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
        {!activeNoteType ? (
          <NoteTypeSelector
            noteTypes={noteTypes}
            onSelect={handleSelectNoteType}
          />
        ) : (
          <NoteWorkflowSteps
            noteType={activeNoteType}
            currentStep={activeCurrentStep}
            stepConfig={currentNoteConfig.steps[activeCurrentStep]}
            formData={activeFormData}
            onDataChange={handleStepDataChange}
            patient={patient}
          />
        )}
      </div>

      {/* Footer */}
      {activeNoteType && (
        <footer className="px-6 py-4 border-t border-border bg-card">
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveDraft}
              disabled={activeIsSaving || isLoading}
              className="font-mono text-xs"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save Draft
            </Button>

            <div className="flex items-center gap-2">
              {activeCurrentStep > 0 && (
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
                  disabled={activeIsSaving || isLoading}
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
