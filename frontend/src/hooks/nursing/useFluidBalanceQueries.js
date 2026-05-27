import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { v2Api } from '@/lib/api/v2/client';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

import {
  DEFAULT_FLUID_BALANCE_SETTINGS,
  adaptV2FluidBalanceItem,
  deriveFluidBalanceAlerts,
  fluidBalanceTrendPoints,
  getV2FluidBalanceEntries,
  normalizeV2FluidBalancePayload,
  rethrowV2Error,
  summarizeFluidBalance,
} from '../nursingQueriesV2Bridge';
import { nursingKeys } from './nursingQueryKeys';

/**
 * Get fluid balance entries for a patient
 * @param {string} patientId - Patient ID
 * @param {Object} filters - Optional filters (entry_type, date, start_date, end_date)
 * @param {Object} options - Query options including enabled
 */
export const useFluidBalance = (patientId, filters = {}, options = {}) => {
  const { enabled = true } = options;
  const { admission, admission_id, entry_type, date, start_date, end_date } = filters;

  return useQuery({
    queryKey: nursingKeys.fluidBalance(
      patientId,
      admission_id || admission,
      entry_type,
      date,
      start_date,
      end_date,
    ),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2FluidBalanceEntries(patientId, filters, { signal });
      }

      const params = new URLSearchParams();
      if (patientId) params.append('patient', patientId);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.append(key, value);
      });
      const response = await apiClient.get(`/nursing/fluid-balance/?${params.toString()}`, { signal });
      const data = response?.data ?? response;
      return data?.results ?? data ?? [];
    },
    enabled: !!patientId && enabled,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: 30000,
    placeholderData: [],
  });
};

/**
 * Get fluid balance summary/totals for a patient on a specific date
 * @param {string} patientId - Patient ID
 * @param {string} date - Optional date (YYYY-MM-DD format, defaults to today)
 * @param {Object} options - Query options including enabled
 */
export const useFluidBalanceSummary = (patientId, date = null, options = {}) => {
  const { enabled = true } = options;
  return useQuery({
    queryKey: nursingKeys.fluidBalanceSummary(patientId, date),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const records = await getV2FluidBalanceEntries(patientId, { date }, { signal });
        return summarizeFluidBalance(records);
      }

      const params = new URLSearchParams();
      params.append('patient', patientId);
      if (date) params.append('date', date);
      const response = await apiClient.get(`/nursing/fluid-balance/patient_summary/?${params.toString()}`, { signal });
      const data = response?.data ?? response;
      return data ?? { total_intake: 0, total_output: 0, balance: 0 };
    },
    enabled: !!patientId && enabled,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: 30000,
    placeholderData: {
      total_intake: 0,
      total_output: 0,
      balance: 0,
      intake_breakdown: {},
      output_breakdown: {},
    },
  });
};

/**
 * Get today's fluid balance for a patient
 * @param {string} patientId - Patient ID
 * @param {Object} options - Query options including enabled
 */
export const useTodayFluidBalance = (patientId, options = {}) => {
  const { enabled = true } = options;
  return useQuery({
    queryKey: nursingKeys.fluidBalanceToday(patientId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const today = new Date().toISOString().slice(0, 10);
        const records = await getV2FluidBalanceEntries(patientId, { date: today }, { signal });
        return summarizeFluidBalance(records);
      }

      const response = await apiClient.get(`/nursing/fluid-balance/today_balance/?patient=${patientId}`, { signal });
      const data = response?.data ?? response;
      return data ?? { total_intake: 0, total_output: 0, balance: 0 };
    },
    enabled: !!patientId && enabled,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: 30000,
    placeholderData: {
      total_intake: 0,
      total_output: 0,
      balance: 0,
    },
  });
};

/**
 * Get aggregated fluid-balance trend points for a patient.
 * @param {string} patientId - Patient ID
 * @param {Object} filters - Optional filters (admission_id, start_date, end_date)
 * @param {Object} options - Query options including enabled
 */
export const useFluidBalanceTrends = (patientId, filters = {}, options = {}) => {
  const { enabled = true } = options;
  const { admission, admission_id, start_date, end_date } = filters;

  return useQuery({
    queryKey: nursingKeys.fluidBalanceTrends(
      patientId,
      admission_id || admission,
      start_date,
      end_date,
    ),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const records = await getV2FluidBalanceEntries(patientId, {
          admission: admission_id || admission,
          start_date,
          end_date,
        }, { signal });
        return fluidBalanceTrendPoints(records);
      }

      const params = new URLSearchParams();
      params.append('patient', patientId);
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, value);
        }
      });
      const response = await apiClient.get(`/nursing/fluid-balance/trends/?${params.toString()}`, { signal });
      const data = response?.data ?? response;
      return data ?? [];
    },
    enabled: !!patientId && enabled,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: 30000,
    placeholderData: [],
  });
};

/**
 * Create a new fluid balance entry
 */
export const useCreateFluidBalance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postFluidBalanceEntries(
            normalizeV2FluidBalancePayload(data),
            { signal: data?.signal },
          );
          return adaptV2FluidBalanceItem(response?.data)[0];
        } catch (error) {
          rethrowV2Error(error, 'Failed to record fluid balance');
        }
      }

      const response = await apiClient.post('/nursing/fluid-balance/', data);
      return response?.data ?? response;
    },
    onSuccess: (data) => {
      if (data?.patient) {
        queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceAll() });
        queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceSummaryAll() });
        queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceTodayAll() });
      }
      queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceAll() });
    },
  });
};

/**
 * Delete a fluid balance entry
 */
export const useDeleteFluidBalance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (entryId) => {
      if (isRustV2ApiMode()) {
        throw new Error('Rust V2 does not expose fluid balance deletion yet.');
      }

      await apiClient.delete(`/nursing/fluid-balance/${entryId}/`);
      return entryId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceSummaryAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceTodayAll() });
    },
  });
};

/**
 * Get fluid balance alert settings (facility-level thresholds)
 */
export const useFluidBalanceSettings = () => {
  return useQuery({
    queryKey: nursingKeys.fluidBalanceSettings(),
    queryFn: async () => {
      if (isRustV2ApiMode()) {
        return DEFAULT_FLUID_BALANCE_SETTINGS;
      }

      const response = await apiClient.get('/settings/fluid-balance/');
      const data = response?.data ?? response;
      return data ?? DEFAULT_FLUID_BALANCE_SETTINGS;
    },
    staleTime: 300000,
    refetchOnWindowFocus: false,
  });
};

/**
 * Check fluid balance alerts for a patient
 * @param {string} patientId - Patient ID
 * @param {string} date - Optional date (YYYY-MM-DD format, defaults to today)
 */
export const useFluidBalanceAlerts = (patientId, date = null) => {
  return useQuery({
    queryKey: nursingKeys.fluidBalanceAlerts(patientId, date),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const records = await getV2FluidBalanceEntries(patientId, { date }, { signal });
        const summary = summarizeFluidBalance(records);
        return {
          alerts: deriveFluidBalanceAlerts(summary),
          thresholds: DEFAULT_FLUID_BALANCE_SETTINGS,
          summary,
        };
      }

      const params = new URLSearchParams();
      params.append('patient', patientId);
      if (date) params.append('date', date);
      const response = await apiClient.get(`/nursing/fluid-balance/check_alerts/?${params.toString()}`);
      const data = response?.data ?? response;
      return data ?? { alerts: [], thresholds: {}, summary: {} };
    },
    enabled: !!patientId,
    refetchInterval: () => !document.hidden ? 60000 : false,
    refetchOnWindowFocus: true,
    staleTime: 30000,
  });
};
