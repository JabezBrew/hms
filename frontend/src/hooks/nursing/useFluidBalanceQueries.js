import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { getV2ClientScopeKey, v2Api } from '@/lib/api/v2/client';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

import {
  DEFAULT_FLUID_BALANCE_SETTINGS,
  adaptV2FluidBalanceItem,
  fluidBalanceCacheScope,
  getV2FluidBalanceEntries,
  getV2FluidBalanceSummary,
  getV2FluidBalanceTrends,
  normalizeV2FluidBalancePayload,
  rethrowV2Error,
} from '../nursingQueriesV2Bridge';
import { nursingKeys } from './nursingQueryKeys';
import { fluidApi } from '@/features/nursing/fluid/api';
import { useFluidBalanceDay } from '@/features/nursing/hooks/useFluidBalanceDay';

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
    queryKey: isRustV2ApiMode()
      ? nursingKeys.fluidBalanceWindow(patientId, getV2ClientScopeKey(), fluidBalanceCacheScope(patientId, filters))
      : nursingKeys.fluidBalance(
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
    placeholderData: isRustV2ApiMode() ? undefined : [],
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
  const resolvedDate = date || new Date().toISOString().slice(0, 10);
  const filters = { date: resolvedDate, admission_case_id: options.admission_case_id || options.admission_id || options.admission };
  return useQuery({
    queryKey: isRustV2ApiMode()
      ? nursingKeys.fluidBalanceSummaryWindow(patientId, getV2ClientScopeKey(), fluidBalanceCacheScope(patientId, filters))
      : nursingKeys.fluidBalanceSummary(patientId, date),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2FluidBalanceSummary(patientId, filters, { signal });
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
    placeholderData: isRustV2ApiMode() ? undefined : {
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
  const day = useFluidBalanceDay({ utc: isRustV2ApiMode(), enabled: enabled && !options.date });
  const filters = { date: options.date || day, admission_case_id: options.admission_case_id || options.admission_id || options.admission };
  return useQuery({
    queryKey: isRustV2ApiMode()
      ? nursingKeys.fluidBalanceSummaryWindow(patientId, getV2ClientScopeKey(), fluidBalanceCacheScope(patientId, filters))
      : nursingKeys.fluidBalanceToday(patientId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) return getV2FluidBalanceSummary(patientId, filters, { signal });
      const response = await apiClient.get(`/nursing/fluid-balance/today_balance/?patient=${patientId}`, { signal });
      return response?.data ?? response ?? { total_intake: 0, total_output: 0, balance: 0 };
    },
    enabled: !!patientId && enabled,
    staleTime: 30000,
    refetchOnWindowFocus: false,
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
    queryKey: isRustV2ApiMode()
      ? nursingKeys.fluidBalanceTrendWindow(patientId, getV2ClientScopeKey(), fluidBalanceCacheScope(patientId, filters))
      : nursingKeys.fluidBalanceTrends(
      patientId,
      admission_id || admission,
      start_date,
      end_date,
    ),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2FluidBalanceTrends(patientId, filters, { signal });
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
    placeholderData: isRustV2ApiMode() ? undefined : [],
  });
};

/**
 * Create a new fluid balance entry
 */
export const useCreateFluidBalance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    retry: false,
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        const payload = normalizeV2FluidBalancePayload(data);
        try {
          const response = await v2Api.postFluidBalanceEntries(
            payload,
            { signal: data?.signal },
          );
          if (!response?.data?.id) throw new Error('Unconfirmed fluid entry response');
          return adaptV2FluidBalanceItem(response?.data)[0];
        } catch (error) {
          if (!(error?.status >= 400 && error?.status < 500) || (error?.data?.error?.code || '').endsWith('_unconfirmed')) {
            const uncertain = new Error('The fluid entry may have been saved. Refresh and review the entries before recording it again.');
            uncertain.name = 'FluidBalanceWriteUnconfirmedError';
            throw uncertain;
          }
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
      queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceTrendsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceAlertsAll() });
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
    queryKey: isRustV2ApiMode() ? [...nursingKeys.fluidBalanceSettings(), getV2ClientScopeKey()] : nursingKeys.fluidBalanceSettings(),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const rules = await fluidApi.rules({ signal });
        return { ...rules.values, version: rules.version, configured: rules.configured };
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
export const useFluidBalanceAlerts = (patientId, date = null, options = {}) => {
  const admissionId = options.admission_case_id || options.admission_id;
  const resolvedDate = date || new Date().toISOString().slice(0, 10);
  return useQuery({
    queryKey: [...nursingKeys.fluidBalanceAlerts(patientId, resolvedDate, isRustV2ApiMode() ? getV2ClientScopeKey() : undefined), admissionId || null],
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        if (!admissionId) return { alerts: [], status: 'admission_required', thresholds: null, summary: null };
        const assessment = await fluidApi.assessment({ admission_case_id: admissionId, date: resolvedDate }, { signal });
        return { alerts: assessment.conditions, status: assessment.status, thresholds: assessment.settings.values, summary: assessment };
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
