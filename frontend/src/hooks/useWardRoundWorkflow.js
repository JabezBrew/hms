import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { patientKeys } from '@/features/patients/hooks/usePatientQueries';
import { clinicalNotesKeys } from '@/hooks/useClinicalNotesQueries';
import { timelineKeys } from '@/hooks/useTimelineQueries';

/**
 * Ward Round workflow step definitions
 * Fixed 4-step structure (not template-driven like notes)
 */
const WARD_ROUND_STEPS = [
  {
    id: 'patient_review',
    title: 'Patient Review',
    description: 'Review overnight events and nursing concerns',
    fields: ['overnight_events', 'nursing_concerns'],
    required: [],
  },
  {
    id: 'clinical_assessment',
    title: 'Clinical Assessment',
    description: 'Examine patient and review vitals',
    fields: ['examination_findings', 'vitals_reviewed'],
    required: ['examination_findings', 'vitals_reviewed'],
  },
  {
    id: 'plan',
    title: 'Treatment Plan',
    description: 'Update assessment, plan, and place orders',
    fields: ['assessment', 'plan_notes', 'orders_placed'],
    required: ['assessment', 'plan_notes'],
  },
  {
    id: 'documentation',
    title: 'Documentation',
    description: 'Review and finalize ward round note',
    fields: ['progress_note', 'estimated_discharge', 'discharge_planning_needed'],
    required: ['progress_note'],
  },
];

/**
 * Validate step data before advancing
 */
function validateStep(stepId, data) {
  const step = WARD_ROUND_STEPS.find(s => s.id === stepId);
  if (!step) return { valid: true };

  const errors = {};

  for (const field of step.required) {
    if (field === 'vitals_reviewed') {
      if (data[field] !== true) {
        errors[field] = 'Please confirm you have reviewed the vitals';
      }
    } else if (!data[field] || (typeof data[field] === 'string' && !data[field].trim())) {
      errors[field] = `${field.replace(/_/g, ' ')} is required`;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Generate progress note from workflow data
 */
function generateProgressNote(formData, contextData) {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const sections = [
    `WARD ROUND NOTE - ${date}`,
    '',
    `Patient: ${contextData?.prep_data?.patient_name || 'Unknown'}`,
    `Location: ${contextData?.ward_name || ''} - Bed ${contextData?.bed_number || ''}`,
    `Day of Admission: ${contextData?.prep_data?.admission_days || 0}`,
    '',
  ];

  if (formData.patient_review?.overnight_events) {
    sections.push('OVERNIGHT EVENTS:');
    sections.push(formData.patient_review.overnight_events);
    sections.push('');
  }

  if (formData.patient_review?.nursing_concerns) {
    sections.push('NURSING CONCERNS:');
    sections.push(formData.patient_review.nursing_concerns);
    sections.push('');
  }

  if (formData.clinical_assessment?.examination_findings) {
    sections.push('EXAMINATION:');
    sections.push(formData.clinical_assessment.examination_findings);
    sections.push('');
  }

  if (formData.plan?.assessment) {
    sections.push('ASSESSMENT:');
    sections.push(formData.plan.assessment);
    sections.push('');
  }

  if (formData.plan?.plan_notes) {
    sections.push('PLAN:');
    sections.push(formData.plan.plan_notes);
    sections.push('');
  }

  const orders = formData.plan?.orders_placed || {};
  const allOrders = [
    ...(orders.medications || []).map(o => `Medication: ${o.medication_name} ${o.dosage} ${o.frequency}`),
    ...(orders.labs || []).map(o => `Lab: ${o.test_name}`),
    ...(orders.imaging || []).map(o => `Imaging: ${o.study} - ${o.body_part}`),
    ...(orders.nursing || []).map(o => `Nursing: ${o.order_text}`),
  ];

  if (allOrders.length > 0) {
    sections.push('ORDERS PLACED:');
    allOrders.forEach(order => sections.push(`- ${order}`));
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * useWardRoundWorkflow - Hook for managing ward round workflow state
 *
 * Features:
 * - Fixed 4-step workflow structure
 * - Workflow lifecycle management (start, update, complete)
 * - Auto-save with debounce
 * - Local state management for form data
 * - Orders collection
 * - API integration with backend WardRoundEngine
 *
 * @param {string} patientId - The patient ID
 * @param {string} admissionId - The admission ID (required for ward rounds)
 * @param {Object} options - Optional configuration
 * @returns {Object} Workflow state and actions
 */
export function useWardRoundWorkflow(patientId, admissionId, options = {}) {
  const queryClient = useQueryClient();

  // Workflow state
  const [workflowId, setWorkflowId] = useState(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({});
  const [contextData, setContextData] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});

  // Auto-save timer ref
  const autoSaveTimerRef = useRef(null);
  const pendingChangesRef = useRef(false);

  // Steps configuration
  const steps = WARD_ROUND_STEPS;
  const totalSteps = steps.length;
  const currentStepConfig = steps[currentStep - 1];
  const isLastStep = currentStep === totalSteps;

  // Start workflow mutation
  const startWorkflowMutation = useMutation({
    mutationFn: async ({ patientId, admissionId, initialData }) => {
      const response = await apiClient.post('/workflows/ward-round/start/', {
        patient_id: patientId,
        admission_id: admissionId,
        initial_data: initialData || {},
      });
      return response;
    },
    onSuccess: (data) => {
      setWorkflowId(data.workflow?.id);
      setContextData(data.workflow?.context_data || data.context_data || {});
      setCurrentStep(1);
      setError(null);
      setFormData({});
    },
    onError: (err) => {
      setError(err.message || 'Failed to start ward round');
    },
  });

  // Update step mutation
  const updateStepMutation = useMutation({
    mutationFn: async ({ workflowId, stepData }) => {
      const response = await apiClient.patch(
        `/workflows/${workflowId}/ward-round/step/`,
        { step_data: stepData }
      );
      return response;
    },
    onSuccess: () => {
      setLastSaved(new Date());
      pendingChangesRef.current = false;
    },
    onError: (err) => {
      console.error('Failed to save step:', err);
    },
  });

  // Complete workflow mutation
  const completeWorkflowMutation = useMutation({
    mutationFn: async ({ workflowId, finalData }) => {
      const response = await apiClient.post(
        `/workflows/${workflowId}/ward-round/complete/`,
        { final_data: finalData }
      );
      return response;
    },
    onSuccess: (data) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) });
      queryClient.invalidateQueries({ queryKey: timelineKeys.list(patientId) });
      queryClient.invalidateQueries({ queryKey: clinicalNotesKeys.entries() });
    },
    onError: (err) => {
      setError(err.message || 'Failed to complete ward round');
    },
  });

  // Start workflow
  const startWorkflow = useCallback(async (initialData = {}) => {
    if (!patientId || !admissionId) {
      setError('Patient ID and Admission ID are required');
      return null;
    }

    try {
      const result = await startWorkflowMutation.mutateAsync({
        patientId,
        admissionId,
        initialData,
      });
      return result;
    } catch (err) {
      return null;
    }
  }, [patientId, admissionId, startWorkflowMutation]);

  // Update step data locally
  const updateStepData = useCallback((stepId, data) => {
    setFormData(prev => ({
      ...prev,
      [stepId]: {
        ...(prev[stepId] || {}),
        ...data,
      },
    }));
    setValidationErrors({});
    pendingChangesRef.current = true;
  }, []);

  // Save draft to backend
  const saveDraft = useCallback(async () => {
    if (!workflowId || !pendingChangesRef.current) return;

    setIsSaving(true);
    try {
      await updateStepMutation.mutateAsync({
        workflowId,
        stepData: formData,
      });
    } finally {
      setIsSaving(false);
    }
  }, [workflowId, formData, updateStepMutation]);

  // Navigate to next step
  const nextStep = useCallback(async () => {
    const stepId = currentStepConfig?.id;
    const stepData = formData[stepId] || {};

    // Validate current step
    const validation = validateStep(stepId, stepData);
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      return false;
    }

    // Save to backend
    if (workflowId) {
      setIsSaving(true);
      try {
        await updateStepMutation.mutateAsync({
          workflowId,
          stepData: formData,
        });
      } finally {
        setIsSaving(false);
      }
    }

    // Advance step
    if (currentStep < totalSteps) {
      setCurrentStep(prev => prev + 1);
      setValidationErrors({});

      // Auto-generate progress note when entering documentation step
      if (currentStep === 3) {
        const generatedNote = generateProgressNote(formData, contextData);
        setFormData(prev => ({
          ...prev,
          documentation: {
            ...(prev.documentation || {}),
            progress_note: prev.documentation?.progress_note || generatedNote,
          },
        }));
      }
    }

    return true;
  }, [currentStep, currentStepConfig, formData, workflowId, totalSteps, contextData, updateStepMutation]);

  // Navigate to previous step
  const prevStep = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
      setValidationErrors({});
    }
  }, [currentStep]);

  // Jump to specific step
  const goToStep = useCallback((stepNumber) => {
    if (stepNumber >= 1 && stepNumber <= totalSteps) {
      setCurrentStep(stepNumber);
      setValidationErrors({});
    }
  }, [totalSteps]);

  // Complete workflow
  const completeWorkflow = useCallback(async () => {
    const stepId = currentStepConfig?.id;
    const stepData = formData[stepId] || {};

    // Validate final step
    const validation = validateStep(stepId, stepData);
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      return null;
    }

    if (!workflowId) {
      setError('Workflow not initialized');
      return null;
    }

    // Prepare final data
    const finalData = {
      ...formData.patient_review,
      ...formData.clinical_assessment,
      ...formData.plan,
      ...formData.documentation,
      orders_placed: formData.plan?.orders_placed || {},
    };

    try {
      const result = await completeWorkflowMutation.mutateAsync({
        workflowId,
        finalData,
      });
      return result;
    } catch (err) {
      return null;
    }
  }, [currentStepConfig, formData, workflowId, completeWorkflowMutation]);

  // Reset workflow state
  const resetWorkflow = useCallback(() => {
    setWorkflowId(null);
    setCurrentStep(1);
    setFormData({});
    setContextData(null);
    setError(null);
    setValidationErrors({});
    setLastSaved(null);
    pendingChangesRef.current = false;

    if (autoSaveTimerRef.current) {
      clearInterval(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  // Auto-save effect
  useEffect(() => {
    if (!workflowId) return;

    autoSaveTimerRef.current = setInterval(() => {
      if (pendingChangesRef.current) {
        saveDraft();
      }
    }, 30000); // 30 seconds

    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
      }
    };
  }, [workflowId, saveDraft]);

  return {
    // State
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
    isLoading: startWorkflowMutation.isPending,
    isCompleting: completeWorkflowMutation.isPending,

    // Actions
    startWorkflow,
    updateStepData,
    saveDraft,
    nextStep,
    prevStep,
    goToStep,
    completeWorkflow,
    resetWorkflow,
    setError,
  };
}

export { WARD_ROUND_STEPS, validateStep, generateProgressNote };
