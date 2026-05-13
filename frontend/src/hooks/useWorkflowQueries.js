import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';
import { dischargeKeys } from '@/features/discharge/hooks/useDischargeCaseQueries';
import { toast } from 'sonner';
import { ensureRustV2WorkflowSupported } from './workflowV2Guard';

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
      ensureRustV2WorkflowSupported('Ward-round workflow start');
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
      ensureRustV2WorkflowSupported('Ward-round workflow step update');
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
      ensureRustV2WorkflowSupported('Ward-round workflow completion');
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
 * Hook for Discharge workflow
 */
export function useDischargeWorkflow() {
  const queryClient = useQueryClient();

  // Start discharge
  const startDischarge = useMutation({
    mutationFn: async ({ patientId, admissionId, initialData }) => {
      ensureRustV2WorkflowSupported('Discharge workflow start');
      return await apiClient.post('/workflows/discharge/start/', {
        patient_id: patientId,
        admission_id: admissionId,
        initial_data: initialData || {},
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(workflowKeys.detail(data.workflow.id), data);
      toast.success('Medical discharge started');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to start medical discharge');
    },
  });

  // Update discharge step
  const updateDischargeStep = useMutation({
    mutationFn: async ({ workflowId, stepData }) => {
      ensureRustV2WorkflowSupported('Discharge workflow step update');
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
      ensureRustV2WorkflowSupported('Discharge workflow completion');
      return await apiClient.post(`/workflows/${workflowId}/discharge/complete/`, {
        final_data: finalData || {},
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dischargeKeys.all });
      queryClient.invalidateQueries(workflowKeys.all);
      toast.success('Medical discharge submitted for clearance');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to submit medical discharge');
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
    queryFn: ({ signal }) => {
      ensureRustV2WorkflowSupported('Workflow detail');
      return apiClient.get(`/workflows/${workflowId}/`, { signal });
    },
    enabled: !!workflowId,
  });
}
