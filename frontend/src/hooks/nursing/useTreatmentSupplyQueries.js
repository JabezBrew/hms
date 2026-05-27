import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { v2Api } from '@/lib/api/v2/client';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

import {
  adaptV2TreatmentSheet,
  adaptV2WardStockRequest,
  addDaysToDateKey,
  buildMARGrid,
  getV2MedicationAdministrations,
  getV2TreatmentSheets,
  getV2WardStockRequests,
  normalizeV2TreatmentSheetPayload,
  normalizeV2WardStockRequestPayload,
  rethrowV2Error,
} from '../nursingQueriesV2Bridge';
import { nursingKeys } from './nursingQueryKeys';

export const useMARGrid = (admissionId, startDate = null, days = 7) => {
  return useQuery({
    queryKey: nursingKeys.marGrid(admissionId, startDate, days),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const firstDate = startDate || new Date().toISOString().slice(0, 10);
        const lastDate = addDaysToDateKey(firstDate, Math.max(1, Number.parseInt(days, 10) || 7) - 1);
        const records = await getV2MedicationAdministrations({
          admission: admissionId,
          start_date: firstDate,
          end_date: lastDate,
        }, { signal });
        return buildMARGrid(records, admissionId, firstDate, days);
      }

      const params = new URLSearchParams();
      params.append('admission_id', admissionId);
      if (startDate) params.append('start_date', startDate);
      params.append('days', days.toString());

      const response = await apiClient.get(`/nursing/medications/mar-grid/?${params.toString()}`);
      return response || { medications: [], date_headers: [], time_slots: [] };
    },
    enabled: !!admissionId,
    refetchInterval: () => !document.hidden ? 60000 : false,
    refetchOnWindowFocus: true,
    staleTime: 30000,
  });
};

export const useTreatmentSheetByAdmission = (admissionId) => {
  return useQuery({
    queryKey: nursingKeys.treatmentSheet(admissionId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2TreatmentSheets({ admission: admissionId }, { signal });
      }

      const response = await apiClient.get(`/nursing/treatment-sheet/by-admission/?admission_id=${admissionId}`);
      return response.data || response || [];
    },
    enabled: !!admissionId,
    refetchInterval: () => !document.hidden ? 120000 : false,
    refetchOnWindowFocus: true,
    staleTime: 60000,
  });
};

export const useTreatmentSheetEntry = (entryId) => {
  return useQuery({
    queryKey: nursingKeys.treatmentSheetEntry(entryId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const entries = await getV2TreatmentSheets({ id: entryId }, { signal });
        return entries[0] || {};
      }

      const response = await apiClient.get(`/nursing/treatment-sheet/${entryId}/`);
      const data = response?.data ?? response;
      return data ?? {};
    },
    enabled: !!entryId,
    placeholderData: {},
  });
};

export const useLowSupplyEntries = () => {
  return useQuery({
    queryKey: nursingKeys.treatmentSheetLowSupply(),
    queryFn: async () => {
      if (isRustV2ApiMode()) {
        return [];
      }

      const response = await apiClient.get('/nursing/treatment-sheet/low-supply/');
      return response.data || response || [];
    },
    refetchInterval: () => !document.hidden ? 120000 : false,
    refetchOnWindowFocus: true,
  });
};

export const useSupplyStatus = (entryId) => {
  return useQuery({
    queryKey: nursingKeys.supplyStatus(entryId),
    queryFn: async () => {
      if (isRustV2ApiMode()) {
        return {
          supported: false,
          status: 'unsupported',
          available: false,
        };
      }

      const response = await apiClient.get(`/nursing/treatment-sheet/${entryId}/supply-status/`);
      const data = response?.data ?? response;
      return data ?? {};
    },
    enabled: !!entryId,
    placeholderData: {},
  });
};

export const useCreateTreatmentEntry = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postTreatmentSheets(
            normalizeV2TreatmentSheetPayload(data),
            { signal: data?.signal },
          );
          return adaptV2TreatmentSheet(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to create treatment sheet');
        }
      }

      const response = await apiClient.post('/nursing/treatment-sheet/', data);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheet(data.admission) });
    },
  });
};

export const useDiscontinueTreatmentEntry = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ entryId, reason }) => {
      if (isRustV2ApiMode()) {
        throw new Error('Rust V2 does not expose treatment-sheet discontinuation yet.');
      }

      const response = await apiClient.post(`/nursing/treatment-sheet/${entryId}/discontinue/`, { reason });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetEntry(data.id) });
    },
  });
};

export const useRequestSupply = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables) => {
      const { entryId, quantity, notes } = variables;
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postWardStockRequests(
            normalizeV2WardStockRequestPayload(variables),
            { signal: variables?.signal },
          );
          return adaptV2WardStockRequest(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to request ward stock');
        }
      }

      const response = await apiClient.post(`/nursing/treatment-sheet/${entryId}/request-supply/`, {
        quantity,
        notes
      });
      return response.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetEntry(variables.entryId) });
      queryClient.invalidateQueries({ queryKey: nursingKeys.supplyRequestsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.supplyStatus(variables.entryId) });
    },
  });
};

export const usePendingSupplyRequests = () => {
  return useQuery({
    queryKey: nursingKeys.supplyRequests('pending'),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2WardStockRequests({ status: 'pending' }, { signal });
      }

      const response = await apiClient.get('/nursing/supply-requests/pending-queue/');
      return response.data || response || [];
    },
    refetchInterval: () => !document.hidden ? 60000 : false,
    refetchOnWindowFocus: true,
  });
};

export const useSupplyRequest = (requestId) => {
  return useQuery({
    queryKey: nursingKeys.supplyRequest(requestId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const requests = await getV2WardStockRequests({ id: requestId }, { signal });
        return requests[0] || {};
      }

      const response = await apiClient.get(`/nursing/supply-requests/${requestId}/`);
      const data = response?.data ?? response;
      return data ?? {};
    },
    enabled: !!requestId,
    placeholderData: {},
  });
};

export const useDispenseSupply = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ requestId, quantityDispensed, signal }) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postWardStockRequestFulfill({ id: requestId }, {
            signal,
          });
          return adaptV2WardStockRequest(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to fulfill ward stock request');
        }
      }

      const response = await apiClient.post(`/nursing/supply-requests/${requestId}/dispense/`, {
        quantity_dispensed: quantityDispensed
      });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.supplyRequestsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.supplyRequest(data.id) });
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetLowSupply() });
    },
  });
};

export const useRejectSupplyRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ requestId, reason }) => {
      if (isRustV2ApiMode()) {
        throw new Error('Rust V2 does not expose ward stock request rejection yet.');
      }

      const response = await apiClient.post(`/nursing/supply-requests/${requestId}/reject/`, { reason });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.supplyRequestsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.supplyRequest(data.id) });
    },
  });
};

export const useBulkDispenseSupply = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables) => {
      const requestIds = Array.isArray(variables) ? variables : variables?.requestIds || [];
      const signal = Array.isArray(variables) ? undefined : variables?.signal;

      if (isRustV2ApiMode()) {
        try {
          const results = await Promise.all(requestIds.map(async (requestId) => {
            const response = await v2Api.postWardStockRequestFulfill({ id: requestId }, {
              signal,
            });
            return adaptV2WardStockRequest(response?.data);
          }));
          return {
            dispensed_count: results.length,
            results,
          };
        } catch (error) {
          rethrowV2Error(error, 'Failed to fulfill ward stock requests');
        }
      }

      const response = await apiClient.post('/nursing/supply-requests/bulk-dispense/', {
        request_ids: requestIds
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.supplyRequestsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.treatmentSheetLowSupply() });
    },
  });
};
