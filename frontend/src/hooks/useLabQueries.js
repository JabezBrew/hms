import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { laboratoryApi } from '@/lib/api/laboratory';

// Query keys
export const labKeys = {
  all: ['laboratory'],
  tests: () => [...labKeys.all, 'tests'],
  testsList: (filters) => [...labKeys.tests(), 'list', { filters }],
  test: (id) => [...labKeys.tests(), id],
  panels: () => [...labKeys.all, 'panels'],
  panelsList: (filters) => [...labKeys.panels(), 'list', { filters }],
  panel: (id) => [...labKeys.panels(), id],
  orders: () => [...labKeys.all, 'orders'],
  ordersList: (filters) => [...labKeys.orders(), 'list', { filters }],
  order: (id) => [...labKeys.orders(), id],
  specimens: () => [...labKeys.all, 'specimens'],
  specimensList: (filters) => [...labKeys.specimens(), 'list', { filters }],
  specimen: (id) => [...labKeys.specimens(), id],
  results: () => [...labKeys.all, 'results'],
  resultsList: (filters) => [...labKeys.results(), 'list', { filters }],
  result: (id) => [...labKeys.results(), id],
};

// ========== Lab Tests ==========

export function useLabTests(filters = {}) {
  return useQuery({
    queryKey: labKeys.testsList(filters),
    queryFn: () => laboratoryApi.getLabTests(filters),
  });
}

export function useLabTest(id) {
  return useQuery({
    queryKey: labKeys.test(id),
    queryFn: () => laboratoryApi.getLabTest(id),
    enabled: !!id,
  });
}

export function useCreateLabTest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => laboratoryApi.createLabTest(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labKeys.tests() });
    },
  });
}

export function useUpdateLabTest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => laboratoryApi.updateLabTest(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: labKeys.test(variables.id) });
      queryClient.invalidateQueries({ queryKey: labKeys.tests() });
    },
  });
}

export function useCustomizeLabTest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => laboratoryApi.customizeLabTest(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: labKeys.test(variables.id) });
      queryClient.invalidateQueries({ queryKey: labKeys.tests() });
    },
  });
}

export function useResetLabTestToDefaults() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => laboratoryApi.resetLabTestToDefaults(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: labKeys.test(id) });
      queryClient.invalidateQueries({ queryKey: labKeys.tests() });
    },
  });
}

export function useDeleteLabTest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => laboratoryApi.deleteLabTest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labKeys.tests() });
    },
  });
}

// ========== Lab Panels ==========

export function useLabPanels(filters = {}) {
  return useQuery({
    queryKey: labKeys.panelsList(filters),
    queryFn: () => laboratoryApi.getLabPanels(filters),
  });
}

export function useLabPanel(id) {
  return useQuery({
    queryKey: labKeys.panel(id),
    queryFn: () => laboratoryApi.getLabPanel(id),
    enabled: !!id,
  });
}

export function useCreateLabPanel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => laboratoryApi.createLabPanel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labKeys.panels() });
    },
  });
}

export function useUpdateLabPanel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => laboratoryApi.updateLabPanel(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: labKeys.panel(variables.id) });
      queryClient.invalidateQueries({ queryKey: labKeys.panels() });
    },
  });
}

export function useCustomizeLabPanel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => laboratoryApi.customizeLabPanel(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: labKeys.panel(variables.id) });
      queryClient.invalidateQueries({ queryKey: labKeys.panels() });
    },
  });
}

export function useResetLabPanelToDefaults() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => laboratoryApi.resetLabPanelToDefaults(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: labKeys.panel(id) });
      queryClient.invalidateQueries({ queryKey: labKeys.panels() });
    },
  });
}

export function useDeleteLabPanel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => laboratoryApi.deleteLabPanel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labKeys.panels() });
    },
  });
}

// ========== Lab Orders ==========

export function useLabOrders(filters = {}) {
  return useQuery({
    queryKey: labKeys.ordersList(filters),
    queryFn: () => laboratoryApi.getLabOrders(filters),
  });
}

export function useLabOrder(id) {
  return useQuery({
    queryKey: labKeys.order(id),
    queryFn: () => laboratoryApi.getLabOrder(id),
    enabled: !!id,
  });
}

export function useCreateLabOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => laboratoryApi.createLabOrder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labKeys.orders() });
    },
  });
}

export function useUpdateLabOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => laboratoryApi.updateLabOrder(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: labKeys.order(variables.id) });
      queryClient.invalidateQueries({ queryKey: labKeys.orders() });
    },
  });
}

export function useSubmitLabOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => laboratoryApi.submitLabOrder(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: labKeys.order(id) });
      queryClient.invalidateQueries({ queryKey: labKeys.orders() });
    },
  });
}

export function useCollectLabOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => laboratoryApi.collectLabOrder(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: labKeys.order(id) });
      queryClient.invalidateQueries({ queryKey: labKeys.orders() });
    },
  });
}

export function useReceiveLabOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => laboratoryApi.receiveLabOrder(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: labKeys.order(id) });
      queryClient.invalidateQueries({ queryKey: labKeys.orders() });
    },
  });
}

export function useStartProcessingLabOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => laboratoryApi.startProcessingLabOrder(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: labKeys.order(id) });
      queryClient.invalidateQueries({ queryKey: labKeys.orders() });
    },
  });
}

export function useCompleteLabOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => laboratoryApi.completeLabOrder(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: labKeys.order(id) });
      queryClient.invalidateQueries({ queryKey: labKeys.orders() });
    },
  });
}

export function useCancelLabOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, cancellationReason }) =>
      laboratoryApi.cancelLabOrder(id, cancellationReason),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: labKeys.order(variables.id) });
      queryClient.invalidateQueries({ queryKey: labKeys.orders() });
    },
  });
}

// ========== Lab Specimens ==========

export function useLabSpecimens(filters = {}) {
  return useQuery({
    queryKey: labKeys.specimensList(filters),
    queryFn: () => laboratoryApi.getLabSpecimens(filters),
  });
}

export function useLabSpecimen(id) {
  return useQuery({
    queryKey: labKeys.specimen(id),
    queryFn: () => laboratoryApi.getLabSpecimen(id),
    enabled: !!id,
  });
}

export function useCreateLabSpecimen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => laboratoryApi.createLabSpecimen(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: labKeys.specimens() });

      // Also invalidate the related order
      if (data.order) {
        queryClient.invalidateQueries({ queryKey: labKeys.order(data.order) });
      }
    },
  });
}

export function useReceiveLabSpecimen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => laboratoryApi.receiveLabSpecimen(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: labKeys.specimen(variables.id) });
      queryClient.invalidateQueries({ queryKey: labKeys.specimens() });

      // Also invalidate the related order
      if (data.order) {
        queryClient.invalidateQueries({ queryKey: labKeys.order(data.order) });
      }
    },
  });
}

// ========== Lab Results ==========

export function useLabResults(filters = {}) {
  return useQuery({
    queryKey: labKeys.resultsList(filters),
    queryFn: () => laboratoryApi.getLabResults(filters),
  });
}

export function useLabResult(id) {
  return useQuery({
    queryKey: labKeys.result(id),
    queryFn: () => laboratoryApi.getLabResult(id),
    enabled: !!id,
  });
}

export function useCreateLabResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => laboratoryApi.createLabResult(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: labKeys.results() });

      // Invalidate the related order
      if (data.order_test?.order) {
        queryClient.invalidateQueries({ queryKey: labKeys.order(data.order_test.order) });
      }
    },
  });
}

export function useVerifyLabResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, verificationNotes }) =>
      laboratoryApi.verifyLabResult(id, verificationNotes),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: labKeys.result(variables.id) });
      queryClient.invalidateQueries({ queryKey: labKeys.results() });

      // Invalidate the related order
      if (data.order_test?.order) {
        queryClient.invalidateQueries({ queryKey: labKeys.order(data.order_test.order) });
      }
    },
  });
}

/**
 * Hook for bulk creating lab results
 * Used by the inline result entry table
 */
export function useBulkCreateLabResults() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => laboratoryApi.bulkCreateResults(data),
    onSuccess: (data, variables) => {
      // Invalidate results queries
      queryClient.invalidateQueries({ queryKey: labKeys.results() });

      // Invalidate the specific order
      if (variables.order_id) {
        queryClient.invalidateQueries({ queryKey: labKeys.order(variables.order_id) });
      }

      // Invalidate orders list
      queryClient.invalidateQueries({ queryKey: labKeys.orders() });
    },
  });
}

/**
 * Hook for bulk verifying lab results
 * Used for batch verification by order or panel
 */
export function useBulkVerifyLabResults() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => laboratoryApi.bulkVerifyResults(data),
    onSuccess: (data, variables) => {
      // Invalidate results queries
      queryClient.invalidateQueries({ queryKey: labKeys.results() });

      // Invalidate the specific order if provided
      if (variables.order_id) {
        queryClient.invalidateQueries({ queryKey: labKeys.order(variables.order_id) });
      }

      // Invalidate orders list
      queryClient.invalidateQueries({ queryKey: labKeys.orders() });
    },
  });
}
