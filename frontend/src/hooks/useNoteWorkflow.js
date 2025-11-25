import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { clinicalNotesApi } from '@/lib/api/clinical-notes';

/**
 * Derive workflow steps from a template structure
 * @param {Object} template - The note template object
 * @returns {Array} Array of step configurations
 */
function deriveStepsFromTemplate(template) {
  if (!template?.structure) return [];

  // Handle both array and object structure formats
  const sections = Array.isArray(template.structure)
    ? template.structure
    : template.structure.sections || [];

  return sections.map((section, index) => ({
    id: section.name?.toLowerCase().replace(/\s+/g, '_') || `step_${index}`,
    title: section.name || section.section || `Step ${index + 1}`,
    type: section.type || 'text',
    required: section.required ?? false,
    subsections: section.subsections || null,
    observationType: section.observationType || section.observation_type || null,
    helpText: section.helpText || null,
    placeholder: section.placeholder || null,
  }));
}

/**
 * useNoteWorkflow - Hook for managing clinical note workflow state
 *
 * Features:
 * - Template-driven workflow (steps derived from template structure)
 * - Workflow lifecycle management (start, update, complete)
 * - Auto-save with debounce
 * - Local state management for form data
 * - API integration
 *
 * @param {string} patientId - The patient ID for the note
 * @returns {Object} Workflow state and actions
 */
export function useNoteWorkflow(patientId) {
  const queryClient = useQueryClient();

  // Workflow state
  const [workflowId, setWorkflowId] = useState(null);
  const [template, setTemplate] = useState(null);  // Now stores full template object
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [error, setError] = useState(null);

  // Auto-save timer ref
  const autoSaveTimerRef = useRef(null);
  const pendingChangesRef = useRef(false);

  // Derive steps from current template
  const steps = useMemo(() => {
    return deriveStepsFromTemplate(template);
  }, [template]);

  // Computed values
  const totalSteps = steps.length;
  const noteType = template?.id || null;  // Use template ID as noteType

  // Start workflow mutation
  const startWorkflowMutation = useMutation({
    mutationFn: async ({ patientId, template }) => {
      const data = await apiClient.post('/workflows/clinical-note/start/', {
        patient_id: patientId,
        note_type: template.category || 'custom',  // Send category as note_type
        template_id: template.id,  // Send template ID
      });
      return data;
    },
    onSuccess: (data) => {
      setWorkflowId(data.id);
      setCurrentStep(1);
      setError(null);
    },
    onError: (error) => {
      setError(error.message || 'Failed to start workflow');
    },
  });

  // Update step mutation
  const updateStepMutation = useMutation({
    mutationFn: async ({ workflowId, stepData, nextStep, noteFields }) => {
      const data = await apiClient.patch(
        `/workflows/${workflowId}/clinical-note/step/`,
        {
          step_data: stepData,
          next_step: nextStep,
          ...noteFields,
        }
      );
      return data;
    },
    onSuccess: (data) => {
      setCurrentStep(data.current_step);
      setLastSaved(new Date());
      pendingChangesRef.current = false;
      setError(null);
    },
    onError: (error) => {
      setError(error.message || 'Failed to update step');
    },
  });

  // Save draft mutation
  const saveDraftMutation = useMutation({
    mutationFn: async ({ workflowId, contextData }) => {
      const data = await apiClient.post(
        `/workflows/${workflowId}/save-draft/`,
        {
          context_data: contextData,
        }
      );
      return data;
    },
    onSuccess: (data) => {
      setLastSaved(new Date(data.last_autosave));
      pendingChangesRef.current = false;
    },
    onError: (error) => {
      console.error('Auto-save failed:', error);
    },
  });

  // Complete workflow mutation - creates note entry directly
  const completeWorkflowMutation = useMutation({
    mutationFn: async ({ workflowId, template, finalData, patientId }) => {
      // If we have a backend workflow, complete it
      if (workflowId) {
        const data = await apiClient.post(
          `/workflows/${workflowId}/clinical-note/complete/`,
          {
            final_data: finalData,
            encounter_type: 'outpatient',
            encounter_status: 'finished',
            template_id: template.id,
          }
        );
        return data;
      }

      // Otherwise, create a note entry directly using the clinical notes API
      const noteEntry = await clinicalNotesApi.createNoteEntry({
        template_id: template.id,
        patient_id: patientId,
        data: finalData,
      });
      return { success: true, note: noteEntry };
    },
    onSuccess: (data) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries(['patient', patientId]);
      queryClient.invalidateQueries(['encounters']);
      queryClient.invalidateQueries(['clinical-notes']);
      queryClient.invalidateQueries(['timeline']);
      setError(null);
    },
    onError: (error) => {
      setError(error.message || 'Failed to complete note');
    },
  });

  // Start a new workflow with a template
  const startWorkflow = useCallback(async (selectedTemplate) => {
    if (!patientId) {
      setError('Patient ID is required');
      return;
    }

    // Store the full template object
    setTemplate(selectedTemplate);
    setFormData({});
    setCurrentStep(0);
    setLastSaved(null);
    setError(null);  // Clear any previous errors

    try {
      await startWorkflowMutation.mutateAsync({
        patientId,
        template: selectedTemplate,
      });
    } catch (err) {
      // If backend workflow fails, still allow local workflow
      console.warn('Backend workflow unavailable, using local mode:', err);
      setError(null);  // Clear error - we're falling back to local mode
      setCurrentStep(1);  // Start at step 1 in local mode
    }
  }, [patientId, startWorkflowMutation]);

  // Update form data for a step
  const updateStepData = useCallback((stepId, data) => {
    setFormData((prev) => ({
      ...prev,
      [stepId]: data,
    }));
    pendingChangesRef.current = true;
  }, []);

  // Save current step and optionally advance
  const saveStep = useCallback(async (nextStepNum = null) => {
    if (!template) return;

    setIsSaving(true);

    try {
      if (workflowId) {
        const currentStepConfig = steps[currentStep - 1];
        const stepData = formData[currentStepConfig?.id] || {};

        await updateStepMutation.mutateAsync({
          workflowId,
          stepData: { [currentStepConfig?.id]: stepData },
          nextStep: nextStepNum,
          noteFields: stepData,
        });
      } else if (nextStepNum) {
        // Local mode - just update step
        setCurrentStep(nextStepNum);
      }
    } finally {
      setIsSaving(false);
    }
  }, [workflowId, template, steps, currentStep, formData, updateStepMutation]);

  // Navigate to next step
  const nextStep = useCallback(async () => {
    if (currentStep < totalSteps) {
      await saveStep(currentStep + 1);
    }
  }, [currentStep, totalSteps, saveStep]);

  // Navigate to previous step
  const prevStep = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep]);

  // Save draft (for auto-save)
  const saveDraft = useCallback(async () => {
    if (!workflowId || !pendingChangesRef.current) return;

    setIsSaving(true);

    try {
      await saveDraftMutation.mutateAsync({
        workflowId,
        contextData: formData,
      });
    } finally {
      setIsSaving(false);
    }
  }, [workflowId, formData, saveDraftMutation]);

  // Complete the workflow
  const completeWorkflow = useCallback(async () => {
    if (!template) return;

    setIsSaving(true);

    try {
      // Build final data from all form data
      // Structure it according to template sections
      const finalData = {};
      steps.forEach((step) => {
        if (formData[step.id]) {
          finalData[step.id] = formData[step.id];
        }
      });

      const result = await completeWorkflowMutation.mutateAsync({
        workflowId,
        template,
        finalData,
        patientId,
      });

      return result;
    } finally {
      setIsSaving(false);
    }
  }, [workflowId, template, steps, formData, patientId, completeWorkflowMutation]);

  // Reset workflow state
  const resetWorkflow = useCallback(() => {
    setWorkflowId(null);
    setTemplate(null);
    setCurrentStep(0);
    setFormData({});
    setLastSaved(null);
    setError(null);

    // Clear auto-save timer
    if (autoSaveTimerRef.current) {
      clearInterval(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  // Auto-save effect
  useEffect(() => {
    if (workflowId) {
      // Set up auto-save every 30 seconds
      autoSaveTimerRef.current = setInterval(() => {
        if (pendingChangesRef.current) {
          saveDraft();
        }
      }, 30000);

      return () => {
        if (autoSaveTimerRef.current) {
          clearInterval(autoSaveTimerRef.current);
        }
      };
    }
  }, [workflowId, saveDraft]);

  // Get current step configuration
  const getCurrentStepConfig = useCallback(() => {
    if (!template || currentStep === 0) return null;

    const stepConfig = steps[currentStep - 1];
    if (!stepConfig) return null;

    return {
      ...stepConfig,
      stepNumber: currentStep,
      totalSteps,
      isFirstStep: currentStep === 1,
      isLastStep: currentStep === totalSteps,
    };
  }, [template, steps, currentStep, totalSteps]);

  return {
    // State
    workflowId,
    noteType,  // Template ID for compatibility
    template,  // Full template object
    currentStep,
    formData,
    isSaving,
    lastSaved,
    error,
    isLoading: startWorkflowMutation.isPending || updateStepMutation.isPending || completeWorkflowMutation.isPending,

    // Derived from template
    steps,
    totalSteps,
    getCurrentStepConfig,

    // Actions
    startWorkflow,
    updateStepData,
    saveStep,
    nextStep,
    prevStep,
    saveDraft,
    completeWorkflow,
    resetWorkflow,
  };
}

export default useNoteWorkflow;
