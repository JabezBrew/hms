import { useState, useCallback, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/**
 * useNoteWorkflow - Hook for managing clinical note workflow state
 *
 * Features:
 * - Workflow lifecycle management (start, update, complete)
 * - Auto-save with debounce
 * - Local state management for form data
 * - API integration
 */
export function useNoteWorkflow(patientId) {
  const queryClient = useQueryClient();

  // Workflow state
  const [workflowId, setWorkflowId] = useState(null);
  const [noteType, setNoteType] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [error, setError] = useState(null);

  // Auto-save timer ref
  const autoSaveTimerRef = useRef(null);
  const pendingChangesRef = useRef(false);

  // Note type configurations
  const noteTypeConfigs = {
    progress: {
      name: 'Progress Note',
      steps: ['chief_complaint', 'assessment', 'plan'],
      totalSteps: 3,
    },
    soap: {
      name: 'SOAP Note',
      steps: ['subjective', 'objective', 'assessment', 'plan'],
      totalSteps: 4,
    },
    procedure: {
      name: 'Procedure Note',
      steps: ['pre_procedure', 'procedure_details', 'post_procedure'],
      totalSteps: 3,
    },
    phone: {
      name: 'Phone Note',
      steps: ['caller_info', 'discussion', 'action_items'],
      totalSteps: 3,
    },
  };

  // Start workflow mutation
  const startWorkflowMutation = useMutation({
    mutationFn: async ({ patientId, noteType }) => {
      const data = await apiClient.post('/workflows/clinical-note/start/', {
        patient_id: patientId,
        note_type: noteType,
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

  // Complete workflow mutation
  const completeWorkflowMutation = useMutation({
    mutationFn: async ({ workflowId, finalData }) => {
      const data = await apiClient.post(
        `/workflows/${workflowId}/clinical-note/complete/`,
        {
          final_data: finalData,
          encounter_type: 'outpatient',
          encounter_status: 'finished',
        }
      );
      return data;
    },
    onSuccess: (data) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries(['patient', patientId]);
      queryClient.invalidateQueries(['encounters']);
      setError(null);
    },
    onError: (error) => {
      setError(error.message || 'Failed to complete note');
    },
  });

  // Start a new workflow
  const startWorkflow = useCallback(async (selectedNoteType) => {
    if (!patientId) {
      setError('Patient ID is required');
      return;
    }

    setNoteType(selectedNoteType);
    setFormData({});
    setCurrentStep(0);
    setLastSaved(null);

    await startWorkflowMutation.mutateAsync({
      patientId,
      noteType: selectedNoteType,
    });
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
  const saveStep = useCallback(async (nextStep = null) => {
    if (!workflowId || !noteType) return;

    setIsSaving(true);

    try {
      const config = noteTypeConfigs[noteType];
      const currentStepId = config.steps[currentStep - 1];
      const stepData = formData[currentStepId] || {};

      await updateStepMutation.mutateAsync({
        workflowId,
        stepData: { [currentStepId]: stepData },
        nextStep,
        noteFields: stepData,
      });
    } finally {
      setIsSaving(false);
    }
  }, [workflowId, noteType, currentStep, formData, updateStepMutation]);

  // Navigate to next step
  const nextStep = useCallback(async () => {
    const config = noteTypeConfigs[noteType];
    if (currentStep < config.totalSteps) {
      await saveStep(currentStep + 1);
    }
  }, [noteType, currentStep, saveStep]);

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
    if (!workflowId) return;

    setIsSaving(true);

    try {
      // First save the current step
      const config = noteTypeConfigs[noteType];
      const currentStepId = config.steps[currentStep - 1];
      const stepData = formData[currentStepId] || {};

      // Build final data from all form data
      const finalData = {};
      Object.entries(formData).forEach(([stepId, data]) => {
        Object.assign(finalData, data);
      });

      const result = await completeWorkflowMutation.mutateAsync({
        workflowId,
        finalData,
      });

      return result;
    } finally {
      setIsSaving(false);
    }
  }, [workflowId, noteType, currentStep, formData, completeWorkflowMutation]);

  // Reset workflow state
  const resetWorkflow = useCallback(() => {
    setWorkflowId(null);
    setNoteType(null);
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
    if (!noteType || currentStep === 0) return null;

    const config = noteTypeConfigs[noteType];
    const stepId = config.steps[currentStep - 1];

    return {
      id: stepId,
      stepNumber: currentStep,
      totalSteps: config.totalSteps,
      isFirstStep: currentStep === 1,
      isLastStep: currentStep === config.totalSteps,
    };
  }, [noteType, currentStep]);

  return {
    // State
    workflowId,
    noteType,
    currentStep,
    formData,
    isSaving,
    lastSaved,
    error,
    isLoading: startWorkflowMutation.isPending || updateStepMutation.isPending || completeWorkflowMutation.isPending,

    // Config
    noteTypeConfigs,
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
