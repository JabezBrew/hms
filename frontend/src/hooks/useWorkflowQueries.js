import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';
import { toast } from 'sonner';

// Query keys
const workflowKeyFactory = createKeyFactory('clinical-workflows');

export const workflowKeys = {
  all: workflowKeyFactory.all,
  details: workflowKeyFactory.details,
  detail: (id) => workflowKeyFactory.detail(id),
  drafts: (type) => keyWith('clinical-workflows', 'drafts', type),
};

/**
 * Hook for Ward Round workflow
 */
export function useWardRoundWorkflow() {
  const queryClient = useQueryClient();

  // Start ward round
  const startWardRound = useMutation({
    mutationFn: async ({ patientId, admissionId, initialData }) => {
      return await apiClient.post('/workflows/ward-round/start/', {
        patient_id: patientId,
        admission_id: admissionId,
        initial_data: initialData || {},
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(workflowKeys.detail(data.workflow.id), data);
      toast.success('Ward round started');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to start ward round');
    },
  });

  // Update ward round step
  const updateWardRoundStep = useMutation({
    mutationFn: async ({ workflowId, stepData }) => {
      return await apiClient.patch(`/workflows/${workflowId}/ward-round/step/`, {
        step_data: stepData,
      });
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(workflowKeys.detail(variables.workflowId), data);
      toast.success('Progress saved');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update step');
    },
  });

  // Complete ward round
  const completeWardRound = useMutation({
    mutationFn: async ({ workflowId, finalData }) => {
      return await apiClient.post(`/workflows/${workflowId}/ward-round/complete/`, {
        final_data: finalData || {},
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(workflowKeys.all);
      toast.success('Ward round completed');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to complete ward round');
    },
  });

  return {
    startWardRound,
    updateWardRoundStep,
    completeWardRound,
  };
}

/**
 * Hook for Admission workflow
 */
export function useAdmissionWorkflow() {
  const queryClient = useQueryClient();

  // Start admission
  const startAdmission = useMutation({
    mutationFn: async ({ patientId, initialData }) => {
      return await apiClient.post('/workflows/admission/start/', {
        patient_id: patientId,
        initial_data: initialData || {},
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(workflowKeys.detail(data.workflow.id), data);
      toast.success('Admission workflow started');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to start admission');
    },
  });

  // Update admission step
  const updateAdmissionStep = useMutation({
    mutationFn: async ({ workflowId, stepData }) => {
      return await apiClient.patch(`/workflows/${workflowId}/admission/step/`, {
        step_data: stepData,
      });
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(workflowKeys.detail(variables.workflowId), data);
      toast.success('Progress saved');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update step');
    },
  });

  // Complete admission
  const completeAdmission = useMutation({
    mutationFn: async ({ workflowId, finalData }) => {
      return await apiClient.post(`/workflows/${workflowId}/admission/complete/`, {
        final_data: finalData || {},
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(workflowKeys.all);
      toast.success('Admission completed');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to complete admission');
    },
  });

  return {
    startAdmission,
    updateAdmissionStep,
    completeAdmission,
  };
}

/**
 * Hook for Discharge workflow
 */
export function useDischargeWorkflow() {
  const queryClient = useQueryClient();

  // Start discharge
  const startDischarge = useMutation({
    mutationFn: async ({ patientId, admissionId, initialData }) => {
      return await apiClient.post('/workflows/discharge/start/', {
        patient_id: patientId,
        admission_id: admissionId,
        initial_data: initialData || {},
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(workflowKeys.detail(data.workflow.id), data);
      toast.success('Discharge workflow started');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to start discharge');
    },
  });

  // Update discharge step
  const updateDischargeStep = useMutation({
    mutationFn: async ({ workflowId, stepData }) => {
      return await apiClient.patch(`/workflows/${workflowId}/discharge/step/`, {
        step_data: stepData,
      });
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(workflowKeys.detail(variables.workflowId), data);
      toast.success('Progress saved');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update step');
    },
  });

  // Complete discharge
  const completeDischarge = useMutation({
    mutationFn: async ({ workflowId, finalData }) => {
      return await apiClient.post(`/workflows/${workflowId}/discharge/complete/`, {
        final_data: finalData || {},
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(workflowKeys.all);
      toast.success('Discharge completed');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to complete discharge');
    },
  });

  return {
    startDischarge,
    updateDischargeStep,
    completeDischarge,
  };
}

/**
 * Get workflow by ID
 */
export function useWorkflowDetail(workflowId) {
  return useQuery({
    queryKey: workflowKeys.detail(workflowId),
    queryFn: () => apiClient.get(`/workflows/${workflowId}/`),
    enabled: !!workflowId,
  });
}
