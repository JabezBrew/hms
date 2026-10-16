import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { getV2ClientScopeKey, v2Api } from '@/lib/api/v2/client';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

import {
  adaptV2Handoff,
  getV2Handoffs,
  normalizeV2HandoffPayload,
  nursingListCacheScope,
  rethrowV2Error,
} from '../nursingQueriesV2Bridge';
import { nursingKeys } from './nursingQueryKeys';

export const useShiftHandoffs = (filters = {}, options = {}) => {
  const rust = isRustV2ApiMode();
  const query = rust ? nursingListCacheScope('handoffs', filters) : null;
  const result = useQuery({
    queryKey: rust ? nursingKeys.handoffList(getV2ClientScopeKey(), query) : options.today ? nursingKeys.shiftHandoffsToday() : nursingKeys.shiftHandoffs(filters.ward, filters.date, filters.shift),
    queryFn: async ({ signal }) => {
      if (rust) return getV2Handoffs(filters, { signal });
      const params = new URLSearchParams(filters);
      const response = await apiClient.get(options.today ? '/nursing/handoffs/today/' : `/nursing/handoffs/?${params.toString()}`, { signal });
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    enabled: options.enabled !== false,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
  return rust ? { ...result, data: result.data?.results, hasNextPage: result.data?.has_next ?? false, nextCursor: result.data?.next_cursor ?? null } : result;
};

export const useTodayHandoffs = (options = {}) => useShiftHandoffs({ ...options, date: new Date().toISOString().slice(0, 10) }, { ...options, today: true });

export const useCreateShiftHandoff = () => {
  const queryClient = useQueryClient();

  return useMutation({
    retry: false,
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postHandoffs(
            normalizeV2HandoffPayload(data),
            { signal: data?.signal },
          );
          return adaptV2Handoff(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to create shift handoff');
        }
      }

      const response = await apiClient.post('/nursing/handoffs/', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.shiftHandoffsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.shiftHandoffsToday() });
    },
  });
};

export const useUpdateShiftHandoff = () => {
  const queryClient = useQueryClient();

  return useMutation({
    retry: false,
    mutationFn: async ({ handoffId, data, signal }) => {
      if (isRustV2ApiMode()) {
        if (data?.status === 'completed' || data?.complete === true) {
          try {
            const response = await v2Api.postHandoffComplete({ id: handoffId }, {
              signal: signal || data?.signal,
            });
            return adaptV2Handoff(response?.data);
          } catch (error) {
            rethrowV2Error(error, 'Failed to finalize shift header');
          }
        }
        throw new Error('Rust V2 does not expose general shift handoff edits yet.');
      }

      const response = await apiClient.patch(`/nursing/handoffs/${handoffId}/`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.shiftHandoffsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.shiftHandoffsToday() });
    },
  });
};
