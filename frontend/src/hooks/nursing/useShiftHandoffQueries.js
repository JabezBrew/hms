import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { v2Api } from '@/lib/api/v2/client';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

import {
  adaptV2Handoff,
  getV2Handoffs,
  normalizeV2HandoffPayload,
  rethrowV2Error,
} from '../nursingQueriesV2Bridge';
import { nursingKeys } from './nursingQueryKeys';

export const useShiftHandoffs = (filters = {}) => {
  const { ward, date, shift } = filters;

  return useQuery({
    queryKey: nursingKeys.shiftHandoffs(ward, date, shift),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2Handoffs(filters, { signal });
      }

      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/handoffs/?${params.toString()}`);
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
};

export const useTodayHandoffs = () => {
  return useQuery({
    queryKey: nursingKeys.shiftHandoffsToday(),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2Handoffs({ date: new Date().toISOString().slice(0, 10) }, { signal });
      }

      const response = await apiClient.get('/nursing/handoffs/today/');
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
  });
};

export const useCreateShiftHandoff = () => {
  const queryClient = useQueryClient();

  return useMutation({
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
    mutationFn: async ({ handoffId, data, signal }) => {
      if (isRustV2ApiMode()) {
        if (data?.status === 'completed' || data?.complete === true) {
          try {
            const response = await v2Api.postHandoffComplete({ id: handoffId }, {
              signal: signal || data?.signal,
            });
            return adaptV2Handoff(response?.data);
          } catch (error) {
            rethrowV2Error(error, 'Failed to complete shift handoff');
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
