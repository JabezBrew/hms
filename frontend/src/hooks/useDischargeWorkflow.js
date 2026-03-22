import { useState, useCallback, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { patientKeys } from '@/features/patients/hooks/usePatientQueries';
import { clinicalNotesKeys } from '@/hooks/useClinicalNotesQueries';
import { timelineKeys } from '@/hooks/useTimelineQueries';
import { wardKeys } from '@/features/wards/hooks/useWardQueries';
import { dischargeKeys } from '@/features/discharge/hooks/useDischargeCaseQueries';

const DISCHARGE_STEPS = [
  {
    id: 'discharge_planning',
    title: 'Medical Discharge Planning',
    description: 'Confirm readiness, destination, and the effective discharge time.',
    required: ['discharge_disposition', 'discharge_date'],
    requiredTrue: [],
  },
  {
    id: 'medications',
    title: 'Medications',
    description: 'Reconcile medications and discharge prescriptions.',
    required: [],
    requiredTrue: ['medications_reconciled'],
  },
  {
    id: 'instructions',
    title: 'Instructions',
    description: 'Document warning signs and follow-up plan.',
    required: ['warning_signs', 'follow_up_appointments'],
    requiredTrue: [],
  },
  {
    id: 'documentation',
    title: 'Submit for Clearance',
    description: 'Finalize the medical discharge summary and hand off for clearance.',
    required: ['discharge_summary'],
    requiredTrue: ['patient_education_complete', 'discharge_instructions_given'],
  },
];

const STEP_FIELD_MAP = {
  discharge_planning: [
    'discharge_criteria_met',
    'discharge_disposition',
    'discharge_date',
    'transportation',
  ],
  medications: [
    'medications_reconciled',
    'discharge_prescriptions',
    'medication_changes',
    'medication_education_completed',
  ],
  instructions: [
    'activity_restrictions',
    'diet_instructions',
    'wound_care',
    'warning_signs',
    'follow_up_appointments',
  ],
  documentation: [
    'discharge_summary',
    'patient_education_complete',
    'discharge_instructions_given',
  ],
};

const BOOLEAN_DEFAULTS = {
  medications_reconciled: false,
  medication_education_completed: false,
  patient_education_complete: false,
  discharge_instructions_given: false,
};

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function normalizeDateTimeValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function validateStep(stepId, stepData) {
  const step = DISCHARGE_STEPS.find((item) => item.id === stepId);
  if (!step) return { valid: true, errors: {} };

  const errors = {};

  for (const field of step.required || []) {
    if (!hasValue(stepData?.[field])) {
      errors[field] = `${field.replace(/_/g, ' ')} is required`;
    }
  }

  for (const field of step.requiredTrue || []) {
    if (stepData?.[field] !== true) {
      errors[field] = `${field.replace(/_/g, ' ')} must be confirmed`;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

function flattenDischargeData(formData) {
  return {
    ...(formData?.discharge_planning || {}),
    ...(formData?.medications || {}),
    ...(formData?.instructions || {}),
    ...(formData?.documentation || {}),
  };
}

function hydrateFormData(dischargeData = {}) {
  const seeded = {};

  for (const [stepId, fields] of Object.entries(STEP_FIELD_MAP)) {
    seeded[stepId] = {};
    for (const field of fields) {
      const value = dischargeData[field];
      if (value !== null && value !== undefined && value !== '') {
        seeded[stepId][field] = field === 'discharge_date' ? normalizeDateTimeValue(value) : value;
      } else if (field in BOOLEAN_DEFAULTS) {
        seeded[stepId][field] = BOOLEAN_DEFAULTS[field];
      }
    }
  }

  return seeded;
}

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `discharge-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useDischargeWorkflow(patientId, admissionId) {
  const queryClient = useQueryClient();

  const [workflowId, setWorkflowId] = useState(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({});
  const [contextData, setContextData] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});

  const autoSaveTimerRef = useRef(null);
  const pendingChangesRef = useRef(false);
  const completionKeyRef = useRef(null);

  const steps = DISCHARGE_STEPS;
  const totalSteps = steps.length;
  const currentStepConfig = steps[currentStep - 1];
  const isLastStep = currentStep === totalSteps;

  const startWorkflowMutation = useMutation({
    mutationFn: async ({ patientId: pid, admissionId: aid, initialData }) => {
      return apiClient.post('/workflows/discharge/start/', {
        patient_id: pid,
        admission_id: aid,
        initial_data: initialData || {},
      });
    },
    onSuccess: (data) => {
      setWorkflowId(data.workflow?.id);
      setContextData(data.workflow?.context_data || {});
      setCurrentStep(Math.max(1, Math.min(data.workflow?.current_step || 1, totalSteps)));
      setFormData(hydrateFormData(data.discharge_data || {}));
      setError(null);
      setValidationErrors({});
    },
    onError: (err) => {
      setError(err.message || 'Failed to start medical discharge workflow');
    },
  });

  const updateStepMutation = useMutation({
    mutationFn: async ({ workflowId: id, stepData }) => {
      return apiClient.patch(`/workflows/${id}/discharge/step/`, {
        step_data: stepData,
      });
    },
    onSuccess: (data) => {
      setLastSaved(new Date());
      pendingChangesRef.current = false;
      const backendStep = data?.workflow?.current_step;
      if (backendStep && Number.isInteger(backendStep)) {
        setCurrentStep((prev) => Math.max(prev, Math.min(backendStep, totalSteps)));
      }
    },
  });

  const completeWorkflowMutation = useMutation({
    mutationFn: async ({ workflowId: id, finalData, idempotencyKey }) => {
      return apiClient.post(`/workflows/${id}/discharge/complete/`, {
        final_data: finalData,
        idempotency_key: idempotencyKey,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dischargeKeys.all });
      queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) });
      queryClient.invalidateQueries({ queryKey: timelineKeys.list(patientId) });
      queryClient.invalidateQueries({ queryKey: clinicalNotesKeys.entries() });
      queryClient.invalidateQueries({ queryKey: wardKeys.admissions() });
    },
    onError: (err) => {
      setError(err.message || 'Failed to submit medical discharge');
    },
  });

  const startWorkflow = useCallback(async (initialData = {}) => {
    if (!patientId || !admissionId) {
      setError('Patient ID and admission ID are required');
      return null;
    }

    try {
      return await startWorkflowMutation.mutateAsync({
        patientId,
        admissionId,
        initialData,
      });
    } catch {
      return null;
    }
  }, [patientId, admissionId, startWorkflowMutation]);

  const updateStepData = useCallback((stepId, data) => {
    setFormData((prev) => ({
      ...prev,
      [stepId]: {
        ...(prev[stepId] || {}),
        ...data,
      },
    }));
    setValidationErrors({});
    pendingChangesRef.current = true;
  }, []);

  const saveDraft = useCallback(async () => {
    if (!workflowId || !pendingChangesRef.current || !currentStepConfig?.id) return;

    const stepPayload = formData[currentStepConfig.id] || {};
    if (Object.keys(stepPayload).length === 0) return;

    setIsSaving(true);
    try {
      await updateStepMutation.mutateAsync({
        workflowId,
        stepData: stepPayload,
      });
    } finally {
      setIsSaving(false);
    }
  }, [workflowId, currentStepConfig, formData, updateStepMutation]);

  const nextStep = useCallback(async () => {
    const stepId = currentStepConfig?.id;
    if (!stepId) return false;

    const stepPayload = formData[stepId] || {};
    const validation = validateStep(stepId, stepPayload);
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      return false;
    }

    if (workflowId) {
      setIsSaving(true);
      try {
        const response = await updateStepMutation.mutateAsync({
          workflowId,
          stepData: stepPayload,
        });

        // Backend normally advances the step; fallback locally if it doesn't.
        const backendStep = response?.workflow?.current_step;
        if (!Number.isInteger(backendStep) && currentStep < totalSteps) {
          setCurrentStep((prev) => prev + 1);
        }
      } finally {
        setIsSaving(false);
      }
    } else if (currentStep < totalSteps) {
      setCurrentStep((prev) => prev + 1);
    }

    setValidationErrors({});
    return true;
  }, [currentStep, currentStepConfig, formData, workflowId, totalSteps, updateStepMutation]);

  const prevStep = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
      setValidationErrors({});
    }
  }, [currentStep]);

  const goToStep = useCallback((stepNumber) => {
    if (stepNumber >= 1 && stepNumber <= totalSteps) {
      setCurrentStep(stepNumber);
      setValidationErrors({});
    }
  }, [totalSteps]);

  const completeWorkflow = useCallback(async () => {
    for (const step of steps) {
      const validation = validateStep(step.id, formData[step.id] || {});
      if (!validation.valid) {
        setCurrentStep(steps.findIndex((item) => item.id === step.id) + 1);
        setValidationErrors(validation.errors);
        return null;
      }
    }

    if (!workflowId) {
      setError('Workflow not initialized');
      return null;
    }

    const finalData = flattenDischargeData(formData);
    if (!completionKeyRef.current) {
      completionKeyRef.current = createIdempotencyKey();
    }

    try {
      const result = await completeWorkflowMutation.mutateAsync({
        workflowId,
        finalData,
        idempotencyKey: completionKeyRef.current,
      });
      completionKeyRef.current = null;
      return result;
    } catch {
      return null;
    }
  }, [steps, formData, workflowId, completeWorkflowMutation]);

  const resetWorkflow = useCallback(() => {
    setWorkflowId(null);
    setCurrentStep(1);
    setFormData({});
    setContextData(null);
    setError(null);
    setValidationErrors({});
    setLastSaved(null);
    completionKeyRef.current = null;
    pendingChangesRef.current = false;

    if (autoSaveTimerRef.current) {
      clearInterval(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!workflowId) return;

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
  }, [workflowId, saveDraft]);

  return {
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

export { DISCHARGE_STEPS, validateStep, flattenDischargeData };
