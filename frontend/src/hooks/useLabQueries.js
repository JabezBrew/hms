import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { laboratoryApi } from '@/features/laboratory/api';
import { aiAssistantApi } from '@/shared/api/aiAssistant';
import { hasMeaningfulQueryParams, immutableMetadataQueryOptions } from '@/lib/react-query';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';

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

const SAFE_LAB_ORDER_STATUS_FIELDS = new Set([
  'status',
  'status_display',
  'v2_status',
  'updated_at',
  'collected_at',
  'received_at',
  'started_at',
  'completed_at',
  'cancelled_at',
]);

function sanitizeLabListFilters(filters = {}) {
  if (!filters || typeof filters !== 'object') {
    return filters;
  }
  const sanitized = { ...filters };
  if (sanitized.search) {
    sanitized.search_hash = hashQueryValue(sanitized.search);
    delete sanitized.search;
  }
  return sanitized;
}

function normalizeOrderId(value) {
  return value == null ? null : String(value);
}

function statusPatchFromOrder(order = {}) {
  if (!order || typeof order !== 'object') {
    return null;
  }
  const orderId = normalizeOrderId(order.id ?? order.order_id ?? order.entity_id);
  const safePatch = Object.fromEntries(
    Object.entries(order).filter(([field]) => SAFE_LAB_ORDER_STATUS_FIELDS.has(field))
  );
  const status = safePatch.status ?? order.state ?? null;
  if (!orderId || !status) {
    return null;
  }
  return {
    orderId,
    patch: {
      ...safePatch,
      status,
      updated_at: safePatch.updated_at ?? order.occurred_at ?? new Date().toISOString(),
    },
  };
}

function filtersFromLabOrderKey(queryKey = []) {
  const filtersPart = queryKey.find((part) => part && typeof part === 'object' && 'filters' in part);
  return filtersPart?.filters || {};
}

function orderMatchesFilters(order, filters = {}) {
  const statusFilter = filters.status;
  if (!statusFilter || statusFilter === 'all') {
    return true;
  }
  return String(order?.status || '').toLowerCase() === String(statusFilter).toLowerCase();
}

function patchLabOrderRecord(order, patch) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    return order;
  }
  return {
    ...order,
    ...patch,
  };
}

function patchLabOrderCollection(data, orderId, patch, filters = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }
  const collectionField = Array.isArray(data.results)
    ? 'results'
    : Array.isArray(data.data)
      ? 'data'
      : null;
  if (!collectionField) {
    return data;
  }

  let touched = false;
  let removed = false;
  const nextItems = data[collectionField].flatMap((order) => {
    if (normalizeOrderId(order?.id ?? order?.order_id) !== orderId) {
      return [order];
    }
    touched = true;
    const updated = patchLabOrderRecord(order, patch);
    if (!orderMatchesFilters(updated, filters)) {
      removed = true;
      return [];
    }
    return [updated];
  });

  if (!touched) {
    return data;
  }

  return {
    ...data,
    [collectionField]: nextItems,
    count: typeof data.count === 'number' && removed ? Math.max(0, data.count - 1) : data.count,
  };
}

export function patchLabOrderStatusSummary(queryClient, order) {
  const statusPatch = statusPatchFromOrder(order);
  if (!statusPatch) {
    return false;
  }
  const { orderId, patch } = statusPatch;
  let patched = false;

  queryClient.setQueryData(labKeys.order(orderId), (current) => {
    const next = patchLabOrderRecord(current, patch);
    if (next !== current) {
      patched = true;
    }
    return next;
  });

  queryClient.getQueriesData({ queryKey: labKeys.orders() }).forEach(([queryKey, current]) => {
    if (queryKey[2] !== 'list' && queryKey[2] !== 'paginated-list') {
      return;
    }
    const next = patchLabOrderCollection(current, orderId, patch, filtersFromLabOrderKey(queryKey));
    if (next !== current) {
      queryClient.setQueryData(queryKey, next);
      patched = true;
    }
  });

  return patched;
}

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
  const queryKeyFilters = sanitizeLabListFilters(filters);
  return useQuery({
    queryKey: labKeys.ordersList(queryKeyFilters),
    queryFn: ({ signal }) => laboratoryApi.getLabOrders(filters, { signal }),
  });
}

export function usePaginatedLabOrders(filters = {}) {
  const queryKeyFilters = sanitizeLabListFilters(filters);
  return useQuery({
    queryKey: labKeys.ordersPaginatedList(queryKeyFilters),
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
      if (!patchLabOrderStatusSummary(queryClient, { ...data, id })) {
        queryClient.invalidateQueries({ queryKey: labKeys.order(id) });
        queryClient.invalidateQueries({ queryKey: labKeys.orders() });
      }
    },
  });
}

export function useCollectLabOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => laboratoryApi.collectLabOrder(id),
    onSuccess: (data, id) => {
      if (!patchLabOrderStatusSummary(queryClient, { ...data, id })) {
        queryClient.invalidateQueries({ queryKey: labKeys.order(id) });
        queryClient.invalidateQueries({ queryKey: labKeys.orders() });
      }
    },
  });
}

export function useReceiveLabOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => laboratoryApi.receiveLabOrder(id),
    onSuccess: (data, id) => {
      if (!patchLabOrderStatusSummary(queryClient, { ...data, id })) {
        queryClient.invalidateQueries({ queryKey: labKeys.order(id) });
        queryClient.invalidateQueries({ queryKey: labKeys.orders() });
      }
    },
  });
}

export function useStartProcessingLabOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => laboratoryApi.startProcessingLabOrder(id),
    onSuccess: (data, id) => {
      if (!patchLabOrderStatusSummary(queryClient, { ...data, id })) {
        queryClient.invalidateQueries({ queryKey: labKeys.order(id) });
        queryClient.invalidateQueries({ queryKey: labKeys.orders() });
      }
    },
  });
}

export function useCompleteLabOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => laboratoryApi.completeLabOrder(id),
    onSuccess: (data, id) => {
      if (!patchLabOrderStatusSummary(queryClient, { ...data, id })) {
        queryClient.invalidateQueries({ queryKey: labKeys.order(id) });
        queryClient.invalidateQueries({ queryKey: labKeys.orders() });
      }
    },
  });
}

export function useCancelLabOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, cancellationReason }) =>
      laboratoryApi.cancelLabOrder(id, cancellationReason),
    onSuccess: (data, variables) => {
      if (!patchLabOrderStatusSummary(queryClient, { ...data, id: variables.id })) {
        queryClient.invalidateQueries({ queryKey: labKeys.order(variables.id) });
        queryClient.invalidateQueries({ queryKey: labKeys.orders() });
      }
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
  const queryKeyFilters = sanitizeLabListFilters(filters);
  return useQuery({
    queryKey: labKeys.resultsList(queryKeyFilters),
    queryFn: ({ signal }) => laboratoryApi.getLabResults(filters, { signal }),
  });
}

export function usePaginatedLabResults(filters = {}) {
  const queryKeyFilters = sanitizeLabListFilters(filters);
  return useQuery({
    queryKey: labKeys.resultsPaginatedList(queryKeyFilters),
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
