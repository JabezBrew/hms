import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';
import { keyWith } from '@/shared/lib/queryKeys';
import { ensureRustV2WorkflowSupported } from './workflowV2Guard';

const workflowKeys = {
  detail: (workflowId) => keyWith('workflow', workflowId),
  list: () => keyWith('workflows'),
  drafts: (filters) => keyWith('draft-workflows', filters),
};

/**
 * Hook for managing clinical workflows
 * Provides methods to start, update, complete, and save drafts
 */
export function useWorkflow(workflowType) {
  const queryClient = useQueryClient();
  const [workflowId, setWorkflowId] = useState(null);

  // Fetch workflow by ID
  const { data: workflow, isLoading, error } = useQuery({
    queryKey: workflowKeys.detail(workflowId),
    queryFn: () => {
      ensureRustV2WorkflowSupported('Workflow detail');
      return apiClient.get(`/workflows/${workflowId}/`);
    },
    enabled: !!workflowId,
  });

  // Start workflow mutation
  const startMutation = useMutation({
    mutationFn: async (data) => {
      ensureRustV2WorkflowSupported('Workflow start');
      const endpoint = `/workflows/${workflowType}/start/`;
      return apiClient.post(endpoint, data);
    },
    onSuccess: (data) => {
      setWorkflowId(data.id);
      queryClient.setQueryData(workflowKeys.detail(data.id), data);
      toast.success('Workflow started');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to start workflow');
    },
  });

  // Update step mutation
  const updateStepMutation = useMutation({
    mutationFn: async ({ stepData, nextStep, consultationFields }) => {
      ensureRustV2WorkflowSupported('Workflow step update');
      const endpoint = `/workflows/${workflowId}/${workflowType}/step/`;
      return apiClient.patch(endpoint, {
        step_data: stepData,
        next_step: nextStep,
        ...consultationFields,
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(workflowKeys.detail(workflowId), data);
      toast.success('Progress saved');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update workflow');
    },
  });

  // Complete workflow mutation
  const completeMutation = useMutation({
    mutationFn: async (finalData) => {
      ensureRustV2WorkflowSupported('Workflow completion');
      const endpoint = `/workflows/${workflowId}/${workflowType}/complete/`;
      return apiClient.post(endpoint, finalData);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries(workflowKeys.detail(workflowId));
      queryClient.invalidateQueries(workflowKeys.list());
      toast.success('Workflow completed successfully');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to complete workflow');
    },
  });

  // Save draft mutation (auto-save)
  const saveDraftMutation = useMutation({
    mutationFn: async (contextData) => {
      ensureRustV2WorkflowSupported('Workflow draft save');
      return apiClient.post(`/workflows/${workflowId}/save-draft/`, {
        context_data: contextData,
      });
    },
    onSuccess: () => {
      // Silent success for auto-save
      console.log('Draft saved');
    },
    onError: (error) => {
      console.error('Failed to save draft:', error);
    },
  });

  // Cancel workflow mutation
  const cancelMutation = useMutation({
    mutationFn: async () => {
      ensureRustV2WorkflowSupported('Workflow cancellation');
      return apiClient.post(`/workflows/${workflowId}/cancel/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(workflowKeys.detail(workflowId));
      queryClient.invalidateQueries(workflowKeys.list());
      toast.success('Workflow cancelled');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to cancel workflow');
    },
  });

  // Load an existing workflow by ID
  const loadWorkflow = useCallback((id) => {
    if (id) {
      setWorkflowId(id);
    }
  }, []);

  // Start workflow
  const startWorkflow = useCallback(async (data) => {
    return startMutation.mutateAsync(data);
  }, []);

  // Update workflow step
  const updateStep = useCallback(async (stepData, nextStep, consultationFields) => {
    return updateStepMutation.mutateAsync({ stepData, nextStep, consultationFields });
  }, []);

  // Complete workflow
  const completeWorkflow = useCallback(async (finalData) => {
    return completeMutation.mutateAsync(finalData);
  }, []);

  // Save draft (auto-save)
  const saveDraft = useCallback(async (contextData) => {
    return saveDraftMutation.mutateAsync(contextData);
  }, []);

  // Cancel workflow
  const cancelWorkflow = useCallback(async () => {
    return cancelMutation.mutateAsync();
  }, []);

  return {
    workflow,
    loading: isLoading,
    error,
    loadWorkflow,
    startWorkflow,
    updateStep,
    completeWorkflow,
    saveDraft,
    cancelWorkflow,
    isStarting: startMutation.isPending,
    isUpdating: updateStepMutation.isPending,
    isCompleting: completeMutation.isPending,
  };
}

/**
 * Hook for fetching draft workflows
 */
export function useDraftWorkflows(filters = {}) {
  return useQuery({
    queryKey: workflowKeys.drafts(filters),
    queryFn: () => {
      ensureRustV2WorkflowSupported('Draft workflows');
      const params = new URLSearchParams(filters);
      return apiClient.get(`/workflows/resume/?${params.toString()}`);
    },
  });
}
