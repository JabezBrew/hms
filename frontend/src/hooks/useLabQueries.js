import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { laboratoryApi } from '@/features/laboratory/api';
import { aiAssistantApi } from '@/shared/api/aiAssistant';
import { hasMeaningfulQueryParams, immutableMetadataQueryOptions } from '@/lib/react-query';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';

// Query keys
const labKeyFactory = createKeyFactory('laboratory');

export const labKeys = {
  all: labKeyFactory.all,
  tests: () => keyWith('laboratory', 'tests'),
  testsList: (filters) => keyWith('laboratory', 'tests', 'list', { filters }),
  test: (id) => keyWith('laboratory', 'tests', id),
  panels: () => keyWith('laboratory', 'panels'),
  panelsList: (filters) => keyWith('laboratory', 'panels', 'list', { filters }),
  panel: (id) => keyWith('laboratory', 'panels', id),
  orders: () => keyWith('laboratory', 'orders'),
  ordersList: (filters) => keyWith('laboratory', 'orders', 'list', { filters }),
  ordersPaginatedList: (filters) => keyWith('laboratory', 'orders', 'paginated-list', { filters }),
  order: (id) => keyWith('laboratory', 'orders', id),
  specimens: () => keyWith('laboratory', 'specimens'),
  specimensList: (filters) => keyWith('laboratory', 'specimens', 'list', { filters }),
  specimen: (id) => keyWith('laboratory', 'specimens', id),
  results: () => keyWith('laboratory', 'results'),
  resultsList: (filters) => keyWith('laboratory', 'results', 'list', { filters }),
  resultsPaginatedList: (filters) => keyWith('laboratory', 'results', 'paginated-list', { filters }),
  result: (id) => keyWith('laboratory', 'results', id),
};

export const labAiKeys = {
  interpretation: ({ resultId = null, orderId = null, audience = 'clinician' } = {}) =>
    keyWith('ai', 'laboratory', 'interpretation', { resultId, orderId, audience }),
};

// ========== Lab Tests ==========

/**
 * Fetch lab tests with optional filters
 * @param {object} filters - Query filters
 * @param {boolean} filters.enabled - Enable/disable the query (for lazy loading)
 */
export function useLabTests(filters = {}) {
  const { enabled = true, ...queryFilters } = filters;
  const shouldUseImmutableCache = !hasMeaningfulQueryParams(queryFilters);
  return useQuery({
    queryKey: labKeys.testsList(queryFilters),
    queryFn: ({ signal }) => laboratoryApi.getLabTests(queryFilters, { signal }),
    enabled,
    ...(shouldUseImmutableCache ? immutableMetadataQueryOptions() : {}),
  });
}

export function useLabTest(id) {
  return useQuery({
    queryKey: labKeys.test(id),
    queryFn: ({ signal }) => laboratoryApi.getLabTest(id, { signal }),
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

/**
 * Fetch lab panels with optional filters
 * @param {object} filters - Query filters
 * @param {boolean} filters.enabled - Enable/disable the query (for lazy loading)
 */
export function useLabPanels(filters = {}) {
  const { enabled = true, ...queryFilters } = filters;
  const shouldUseImmutableCache = !hasMeaningfulQueryParams(queryFilters);
  return useQuery({
    queryKey: labKeys.panelsList(queryFilters),
    queryFn: ({ signal }) => laboratoryApi.getLabPanels(queryFilters, { signal }),
    enabled,
    ...(shouldUseImmutableCache ? immutableMetadataQueryOptions() : {}),
  });
}

export function useLabPanel(id) {
  return useQuery({
    queryKey: labKeys.panel(id),
    queryFn: ({ signal }) => laboratoryApi.getLabPanel(id, { signal }),
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
    queryFn: ({ signal }) => laboratoryApi.getLabOrders(filters, { signal }),
  });
}

export function usePaginatedLabOrders(filters = {}) {
  return useQuery({
    queryKey: labKeys.ordersPaginatedList(filters),
    queryFn: ({ signal }) => laboratoryApi.getLabOrdersPaginated(filters, { signal }),
  });
}

export function useLabOrder(id) {
  return useQuery({
    queryKey: labKeys.order(id),
    queryFn: ({ signal }) => laboratoryApi.getLabOrder(id, { signal }),
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
    queryFn: ({ signal }) => laboratoryApi.getLabSpecimens(filters, { signal }),
  });
}

export function useLabSpecimen(id) {
  return useQuery({
    queryKey: labKeys.specimen(id),
    queryFn: ({ signal }) => laboratoryApi.getLabSpecimen(id, { signal }),
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
    queryFn: ({ signal }) => laboratoryApi.getLabResults(filters, { signal }),
  });
}

export function usePaginatedLabResults(filters = {}) {
  return useQuery({
    queryKey: labKeys.resultsPaginatedList(filters),
    queryFn: ({ signal }) => laboratoryApi.getLabResultsPaginated(filters, { signal }),
  });
}

export function useLabResult(id) {
  return useQuery({
    queryKey: labKeys.result(id),
    queryFn: ({ signal }) => laboratoryApi.getLabResult(id, { signal }),
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

/**
 * Fetch AI interpretation for a single result or an order.
 * Exactly one of resultId or orderId is required.
 */
export function useLabInterpretation({
  resultId = null,
  orderId = null,
  audience = 'clinician',
  enabled = true,
} = {}) {
  const hasResult = Boolean(resultId);
  const hasOrder = Boolean(orderId);
  const shouldFetch = Boolean(enabled) && hasResult !== hasOrder;

  return useQuery({
    queryKey: labAiKeys.interpretation({ resultId, orderId, audience }),
    queryFn: () => {
      if (hasResult) {
        return aiAssistantApi.interpretLabResult({ resultId, audience });
      }
      return aiAssistantApi.interpretLabOrder({ orderId, audience });
    },
    enabled: shouldFetch,
    staleTime: 60 * 1000,
  });
}
