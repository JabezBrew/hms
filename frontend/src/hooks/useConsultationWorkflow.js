import { useState, useCallback, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { patientKeys } from '@/features/patients/hooks/usePatientQueries';
import { clinicalNotesKeys } from '@/hooks/useClinicalNotesQueries';
import { timelineKeys } from '@/hooks/useTimelineQueries';
import { referralKeys } from '@/hooks/useReferralQueries';
import { ensureRustV2WorkflowSupported } from './workflowV2Guard';

// Hoist RegExp patterns to module scope for performance
const UNDERSCORE_REGEX = /_/g;
const WORD_START_REGEX = /\b\w/g;

/**
 * Format a field key to a readable label.
 * @param {string} field - The field key (e.g., 'chief_complaint')
 * @returns {string} - Formatted label (e.g., 'Chief Complaint')
 */
function formatFieldLabel(field) {
  return field.replace(UNDERSCORE_REGEX, ' ').replace(WORD_START_REGEX, l => l.toUpperCase());
}

/**
 * Consultation workflow step definitions
 * 3-step structure for outpatient/clinic consultations
 */
const CONSULTATION_STEPS = [
  {
    id: 'patient_review',
    title: 'Patient Review',
    description: 'Review patient history and referral context',
    fields: ['reviewed'],
    required: [],
  },
  {
    id: 'history_exam',
    title: 'History & Exam',
    description: 'Document chief complaint, HPI, and examination',
    fields: ['chief_complaint', 'hpi', 'ros', 'physical_exam'],
    required: ['chief_complaint'],
  },
  {
    id: 'assessment_plan',
    title: 'Assessment & Plan',
    description: 'Formulate assessment and treatment plan',
    fields: ['assessment', 'plan', 'orders_placed'],
    required: ['assessment'],
  },
];

/**
 * Validate step data before advancing
 */
function validateStep(stepId, data) {
  const step = CONSULTATION_STEPS.find(s => s.id === stepId);
  if (!step) return { valid: true };

  const errors = {};

  for (const field of step.required) {
    if (!data[field] || (typeof data[field] === 'string' && !data[field].trim())) {
      errors[field] = `${formatFieldLabel(field)} is required`;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Generate consultation note from workflow data
 */
function generateConsultationNote(formData, contextData) {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const sections = [
    `CONSULTATION NOTE - ${date}`,
    '',
    `Patient: ${contextData?.prep_data?.patient_name || 'Unknown'}`,
    `MRN: ${contextData?.prep_data?.medical_record_number || 'N/A'}`,
    '',
  ];

  // Add referral context if present
  if (contextData?.prep_data?.referral) {
    sections.push('REFERRAL INFORMATION:');
    sections.push(`Referring Provider: ${contextData.prep_data.referral.referring_doctor || 'Unknown'}`);
    sections.push(`Reason: ${contextData.prep_data.referral.reason || 'Not specified'}`);
    sections.push('');
  }

  if (formData.history_exam?.chief_complaint) {
    sections.push('CHIEF COMPLAINT:');
    sections.push(formData.history_exam.chief_complaint);
    sections.push('');
  }

  if (formData.history_exam?.hpi) {
    sections.push('HISTORY OF PRESENT ILLNESS:');
    sections.push(formData.history_exam.hpi);
    sections.push('');
  }

  if (formData.history_exam?.ros) {
    sections.push('REVIEW OF SYSTEMS:');
    sections.push(formData.history_exam.ros);
    sections.push('');
  }

  if (formData.history_exam?.physical_exam) {
    sections.push('PHYSICAL EXAMINATION:');
    sections.push(formData.history_exam.physical_exam);
    sections.push('');
  }

  if (formData.assessment_plan?.assessment) {
    sections.push('ASSESSMENT:');
    sections.push(formData.assessment_plan.assessment);
    sections.push('');
  }

  if (formData.assessment_plan?.plan) {
    sections.push('PLAN:');
    sections.push(formData.assessment_plan.plan);
    sections.push('');
  }

  // Add orders if any
  const orders = formData.assessment_plan?.orders_placed || {};
  const allOrders = [
    ...(orders.medications || []).map(o => `Medication: ${o.medication_name} ${o.dosage} ${o.frequency}`),
    ...(orders.labs || []).map(o => `Lab: ${o.test_name}`),
    ...(orders.imaging || []).map(o => `Imaging: ${o.study} - ${o.body_part}`),
    ...(orders.referrals || []).map(o => `Referral: ${o.specialty}`),
  ];

  if (allOrders.length > 0) {
    sections.push('ORDERS:');
    allOrders.forEach(order => sections.push(`- ${order}`));
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * useConsultationWorkflow - Hook for managing consultation workflow state
 *
 * Features:
 * - 3-step workflow structure (Patient Review, History & Exam, Assessment & Plan)
 * - Workflow lifecycle management (start, update, complete)
 * - Auto-save with debounce
 * - Local state management for form data
 * - Orders collection
 * - API integration with backend ConsultationEngine
 *
 * @param {string} patientId - The patient ID
 * @param {Object} options - Optional configuration (referralId, appointmentId)
 * @returns {Object} Workflow state and actions
 */
export function useConsultationWorkflow(patientId, options = {}) {
  const queryClient = useQueryClient();
  const { referralId, appointmentId, encounterId } = options;

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
  const steps = CONSULTATION_STEPS;
  const totalSteps = steps.length;
  const currentStepConfig = steps[currentStep - 1];
  const isLastStep = currentStep === totalSteps;

  // Start workflow mutation
  const startWorkflowMutation = useMutation({
    mutationFn: async ({ patientId, referralId, appointmentId, encounterId, initialData }) => {
      ensureRustV2WorkflowSupported('Consultation workflow start');
      const response = await apiClient.post('/workflows/consultation/start/', {
        patient_id: patientId,
        referral_id: referralId || undefined,
        appointment_id: appointmentId || undefined,
        encounter_id: encounterId || undefined,
        initial_data: initialData || {},
      });
      return response;
    },
    onSuccess: (data) => {
      setWorkflowId(data.workflow?.id || data.id);
      setContextData(data.workflow?.context_data || data.context_data || {});
      setCurrentStep(1);
      setError(null);
      setFormData({});
    },
    onError: (err) => {
      setError(err.message || 'Failed to start consultation');
    },
  });

  // Update step mutation
  const updateStepMutation = useMutation({
    mutationFn: async ({ workflowId, stepData }) => {
      ensureRustV2WorkflowSupported('Consultation workflow step update');
      const response = await apiClient.patch(
        `/workflows/${workflowId}/consultation/step/`,
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
      ensureRustV2WorkflowSupported('Consultation workflow completion');
      const response = await apiClient.post(
        `/workflows/${workflowId}/consultation/complete/`,
        { final_data: finalData }
      );
      return response;
    },
    onSuccess: (data) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) });
      queryClient.invalidateQueries({ queryKey: timelineKeys.list(patientId) });
      queryClient.invalidateQueries({ queryKey: clinicalNotesKeys.entries() });
      queryClient.invalidateQueries({ queryKey: referralKeys.all });
    },
    onError: (err) => {
      setError(err.message || 'Failed to complete consultation');
    },
  });

  // Start workflow
  const startWorkflow = useCallback(async (initialData = {}) => {
    if (!patientId) {
      setError('Patient ID is required');
      return null;
    }

    try {
      const result = await startWorkflowMutation.mutateAsync({
        patientId,
        referralId,
        appointmentId,
        encounterId,
        initialData,
      });
      return result;
    } catch (err) {
      return null;
    }
  }, [patientId, referralId, appointmentId, encounterId, startWorkflowMutation]);

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

  // Navigate to next step (local only — form data is in React state, auto-save
  // and /complete cover persistence; no need for a PATCH per click).
  const nextStep = useCallback(() => {
    const stepId = currentStepConfig?.id;
    const stepData = formData[stepId] || {};

    const validation = validateStep(stepId, stepData);
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      return false;
    }

    if (currentStep < totalSteps) {
      setCurrentStep((prev) => prev + 1);
      setValidationErrors({});
    }

    return true;
  }, [currentStep, currentStepConfig, formData, totalSteps]);

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

    // Generate consultation note
    const consultationNote = generateConsultationNote(formData, contextData);

    // Prepare final data
    const finalData = {
      ...formData.patient_review,
      ...formData.history_exam,
      ...formData.assessment_plan,
      consultation_note: consultationNote,
      orders_placed: formData.assessment_plan?.orders_placed || {},
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
  }, [currentStepConfig, formData, workflowId, contextData, completeWorkflowMutation]);

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

export { CONSULTATION_STEPS, validateStep, generateConsultationNote };
