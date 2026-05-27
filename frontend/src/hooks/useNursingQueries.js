import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { v2Api } from '@/lib/api/v2/client';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

import {
  MAX_MONITORING_PAGE_SIZE,
  MAX_VITALS_PAGE_SIZE,
  DEFAULT_FLUID_BALANCE_SETTINGS,
  rethrowV2Error,
  adaptV2WardBoardMonitoringItem,
  adaptV2NursingAlert,
  adaptV2NursingTask,
  adaptV2MedicationAdministration,
  adaptV2TreatmentSheet,
  adaptV2WardStockRequest,
  adaptV2FluidBalanceItem,
  adaptV2PatientVitals,
  normalizeV2FluidBalancePayload,
  normalizeV2TreatmentSheetPayload,
  normalizeV2WardStockRequestPayload,
  normalizeV2MedicationAdministrationPayload,
  normalizeV2MedicationAdministerPayload,
  normalizeV2TaskPayload,
  normalizeV2CreateVitalsPayload,
  addDaysToDateKey,
  buildPatientMAR,
  buildMARGrid,
  isDueMedicationAdministration,
  getV2MedicationAdministrations,
  getV2TreatmentSheets,
  getV2WardStockRequests,
  summarizeFluidBalance,
  fluidBalanceTrendPoints,
  deriveFluidBalanceAlerts,
  getV2FluidBalanceEntries,
  getV2NursingAlerts,
  getV2NursingTasks,
  getV2PatientVitals,
  getV2PendingPharmacyQueue,
} from './nursingQueriesV2Bridge';
import { nursingKeys } from './nursing/nursingQueryKeys';
import {
  useCreateShiftHandoff,
  useShiftHandoffs,
  useTodayHandoffs,
  useUpdateShiftHandoff,
} from './nursing/useShiftHandoffQueries';

export {
  nursingKeys,
  useCreateShiftHandoff,
  useShiftHandoffs,
  useTodayHandoffs,
  useUpdateShiftHandoff,
};

// ========== Patient Monitoring ==========

export const usePatientMonitoring = (wardId = null, page = 1, pageSize = 20) => {
  const normalizedPageSize = Math.max(1, Math.min(pageSize, MAX_MONITORING_PAGE_SIZE));

  return useQuery({
    queryKey: nursingKeys.patientMonitoring(wardId, page, normalizedPageSize),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.getWardBoard({
            query: {
              limit: normalizedPageSize,
              ...(wardId ? { ward_id: wardId } : {}),
            },
            signal,
          });
          const results = Array.isArray(response?.data)
            ? response.data.map(adaptV2WardBoardMonitoringItem)
            : [];
          const hasNext = Boolean(response?.page?.has_next);
          return {
            count: results.length + (hasNext ? 1 : 0),
            page,
            page_size: normalizedPageSize,
            total_pages: hasNext ? page + 1 : Math.max(1, page),
            results,
          };
        } catch (error) {
          rethrowV2Error(error, 'Failed to load patient monitoring data');
        }
      }

      const params = new URLSearchParams();
      if (wardId) params.append('ward', wardId);
      params.append('page', page.toString());
      params.append('page_size', normalizedPageSize.toString());

      // Use getWithPagination to get the full paginated response, not just results
      const data = await apiClient.getWithPagination(`/nursing/monitoring/dashboard/?${params.toString()}`, { signal });

      // Handle both array and paginated object responses
      if (!data) {
        return {
          count: 0,
          page: 1,
          page_size: normalizedPageSize,
          total_pages: 0,
          results: []
        };
      }

      // If backend returns array directly (not paginated), wrap it
      if (Array.isArray(data)) {
        return {
          count: data.length,
          page: page,
          page_size: normalizedPageSize,
          total_pages: Math.ceil(data.length / normalizedPageSize),
          results: data
        };
      }

      // If backend returns paginated object, use it directly
      return data;
    },
    // Provide placeholder data while loading to prevent undefined
    placeholderData: {
      count: 0,
      page: 1,
      page_size: normalizedPageSize,
      total_pages: 0,
      results: []
    },
    refetchInterval: () => {
      // Only refetch if window is focused
      if (!document.hidden) {
        return 60000; // 1 minute when focused
      }
      return false; // Don't refetch when tab is not visible
    },
    refetchOnWindowFocus: true, // Refetch when user comes back to tab
    refetchIntervalInBackground: false, // Don't refetch in background
    staleTime: 30000, // Consider data stale after 30 seconds
    retry: 1, // Retry once on failure
  });
};

export const usePatientDetail = (patientId, options = {}) => {
  const { enabled = true, ...queryOptions } = options;

  return useQuery({
    queryKey: nursingKeys.patientDetail(patientId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.getWardBoard({
            query: { limit: 1, patient_id: patientId },
            signal,
          });
          const rows = Array.isArray(response?.data)
            ? response.data.map(adaptV2WardBoardMonitoringItem)
            : [];
          return rows[0] || {};
        } catch (error) {
          rethrowV2Error(error, 'Failed to load patient monitoring detail');
        }
      }

      const response = await apiClient.get(`/nursing/monitoring/patient_detail/?patient=${patientId}`);
      // Ensure we always return an object
      const data = response?.data ?? response;
      return data || {};
    },
    enabled: !!patientId && enabled,
    placeholderData: {},
    refetchInterval: () => !document.hidden ? 60000 : false,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    staleTime: 30000,
    ...queryOptions,
  });
};

// ========== Vital Signs ==========

export const useVitalSigns = (filters = {}, options = {}) => {
  const { enabled = true } = options;
  // Extract filter values to use as stable primitives in query key
  const {
    patient,
    admission,
    encounter,
    encounter_id,
    date,
    start_date,
    end_date,
    hours,
    ordering,
    limit,
  } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls
    queryKey: nursingKeys.vitalSigns(
      patient,
      admission,
      encounter_id || encounter,
      date,
      start_date,
      end_date,
      hours,
      ordering,
      limit,
    ),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2PatientVitals(filters, { signal });
      }
      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/vital-signs/?${params.toString()}`, { signal });
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? [];
    },
    enabled,
    placeholderData: [],
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
};

export const useVitalSignsTrends = (patientId, filters = {}, options = {}) => {
  const { enabled = true } = options;
  const {
    days,
    encounter_id,
    admission_id,
    start_date,
    end_date,
  } = filters;

  return useQuery({
    queryKey: nursingKeys.vitalSignsTrends(
      patientId,
      days,
      encounter_id,
      admission_id,
      start_date,
      end_date,
    ),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const daysAsHours = Math.max(1, Number.parseInt(days, 10) || 7) * 24;
        return getV2PatientVitals({
          patient: patientId,
          admission_case_id: admission_id,
          hours: daysAsHours,
          ordering: '-recorded_at',
          limit: MAX_VITALS_PAGE_SIZE,
        }, { signal });
      }
      const params = new URLSearchParams();
      params.append('patient', patientId);
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, value);
        }
      });
      const response = await apiClient.get(`/nursing/vital-signs/patient_trends/?${params.toString()}`, { signal });
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? [];
    },
    enabled: !!patientId && enabled,
    placeholderData: [],
  });
};

export const useCreateVitalSigns = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postPatientVitals(
            normalizeV2CreateVitalsPayload(data),
            { signal: data?.signal },
          );
          return adaptV2PatientVitals(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to record vital signs');
        }
      }
      // apiClient.post returns data directly, not wrapped in response.data
      const result = await apiClient.post('/nursing/vital-signs/', data);
      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.vitalSignsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.vitalSignsTrendsByPatient(data?.patient) });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientDetail(data?.patient) });
    },
  });
};

// ========== Nursing Tasks ==========

export const useNursingTasks = (filters = {}) => {
  // Extract filter values to use as stable primitives in query key
  const { patient, status, ward, date, task_type, priority } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls
    queryKey: nursingKeys.nursingTasks(patient, status, ward, date, task_type, priority),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2NursingTasks(filters, { signal });
      }

      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/tasks/?${params.toString()}`);
      // Ensure we always return an array
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
};

export const useTodayTasks = () => {
  return useQuery({
    queryKey: nursingKeys.nursingTasksToday(),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2NursingTasks({ date: new Date().toISOString().slice(0, 10) }, { signal });
      }

      const response = await apiClient.get('/nursing/tasks/today/');
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    refetchInterval: 60000, // Refetch every minute
  });
};

export const useCreateNursingTask = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postNursingTasks(
            normalizeV2TaskPayload(data),
            { signal: data?.signal },
          );
          return adaptV2NursingTask(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to create nursing task');
        }
      }

      const response = await apiClient.post('/nursing/tasks/', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingTasksAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingTasksToday() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
    },
  });
};

export const useCompleteTask = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, data, signal }) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postNursingTaskComplete({ id: taskId }, {
            signal: signal || data?.signal,
          });
          return adaptV2NursingTask(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to complete nursing task');
        }
      }

      const response = await apiClient.post(`/nursing/tasks/${taskId}/complete/`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingTasksAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingTasksToday() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
    },
  });
};

export const useUpdateTask = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, data, status, signal }) => {
      if (isRustV2ApiMode()) {
        const requestedStatus = data?.status || status;
        if (requestedStatus === 'completed' || data?.complete === true) {
          try {
            const response = await v2Api.postNursingTaskComplete({ id: taskId }, {
              signal: signal || data?.signal,
            });
            return adaptV2NursingTask(response?.data);
          } catch (error) {
            rethrowV2Error(error, 'Failed to complete nursing task');
          }
        }
        if (requestedStatus === 'cancelled') {
          try {
            const response = await v2Api.postNursingTaskCancel({ id: taskId }, {
              signal: signal || data?.signal,
            });
            return adaptV2NursingTask(response?.data);
          } catch (error) {
            rethrowV2Error(error, 'Failed to cancel nursing task');
          }
        }
        throw new Error('Rust V2 does not expose general nursing task edits yet.');
      }

      const response = await apiClient.patch(`/nursing/tasks/${taskId}/`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingTasksAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingTasksToday() });
    },
  });
};

// ========== Nursing Alerts ==========

export const useNursingAlerts = (filters = {}) => {
  // Extract filter values to use as stable primitives in query key
  const { patient, ward, severity, status } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls
    queryKey: nursingKeys.nursingAlerts(patient, ward, severity, status),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2NursingAlerts(filters, { signal });
      }

      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/alerts/?${params.toString()}`);
      // Ensure we always return an array
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    refetchInterval: false, // Disable automatic polling - manually refresh when needed
    refetchOnWindowFocus: false,
    staleTime: 20000,
  });
};

export const useActiveAlerts = () => {
  return useQuery({
    queryKey: nursingKeys.nursingAlertsActive(),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const alerts = await getV2NursingAlerts({}, { signal });
        return alerts.filter((alert) => !alert.acknowledged && alert.status !== 'resolved');
      }

      // Use getWithPagination to avoid auto-extraction of results
      const data = await apiClient.getWithPagination('/nursing/alerts/active/', { signal });

      // Ensure we always return an array
      if (!data) {
        return [];
      }

      // Handle both array and object responses
      return Array.isArray(data) ? data : [];
    },
    // Provide placeholder data while loading to prevent undefined
    placeholderData: [],
    refetchInterval: () => !document.hidden ? 45000 : false, // 45 seconds when focused
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    staleTime: 20000,
    retry: 1,
  });
};

export const useAcknowledgeAlert = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ alertId, notes, signal }) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postNursingAlertAcknowledge({ id: alertId }, {
            signal,
          });
          return adaptV2NursingAlert(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to acknowledge nursing alert');
        }
      }

      const response = await apiClient.post(`/nursing/alerts/${alertId}/acknowledge/`, {
        resolution_notes: notes,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingAlertsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.nursingAlertsActive() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
    },
  });
};

// ========== Medication Administration ==========

export const useMedicationAdministrations = (filters = {}) => {
  // Extract filter values to use as stable primitives in query key
  const { patient, admission, date, status } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls
    queryKey: nursingKeys.medicationAdministrations(patient, admission, date, status),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2MedicationAdministrations(filters, { signal });
      }

      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/medications/?${params.toString()}`);
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
};

export const useMedicationAdministrationHistory = (filters = {}, options = {}) => {
  const {
    patient,
    status,
    start_date,
    end_date,
    ordering = '-scheduled_time',
    page = 1,
    page_size = 20,
  } = filters;
  const { enabled = true } = options;

  return useQuery({
    queryKey: nursingKeys.medicationAdministrationHistory(
      patient,
      status,
      start_date,
      end_date,
      ordering,
      page,
      page_size,
    ),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const results = await getV2MedicationAdministrations({
          patient,
          status,
          start_date,
          end_date,
        }, { signal });
        return {
          count: results.length,
          results,
          page,
          total_pages: 1,
          has_next: false,
          has_previous: false,
        };
      }

      const params = new URLSearchParams();
      if (patient) params.append('patient', patient);
      if (status && status !== 'all') params.append('status', status);
      if (start_date) params.append('start_date', start_date);
      if (end_date) params.append('end_date', end_date);
      if (ordering) params.append('ordering', ordering);
      params.append('page', String(page));
      params.append('page_size', String(page_size));

      const response = await apiClient.getWithPagination(`/nursing/medications/?${params.toString()}`, { signal });

      if (Array.isArray(response)) {
        return {
          count: response.length,
          results: response,
          page,
          total_pages: 1,
          has_next: false,
          has_previous: false,
        };
      }

      return response ?? {
        count: 0,
        results: [],
        page,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      };
    },
    enabled: !!patient && enabled,
    placeholderData: {
      count: 0,
      results: [],
      page,
      total_pages: 1,
      has_next: false,
      has_previous: false,
    },
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
};

export const useMedicationsDueNow = () => {
  return useQuery({
    queryKey: nursingKeys.medicationsDueNow(),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const rows = await getV2MedicationAdministrations({ status: 'scheduled' }, { signal });
        return rows.filter(isDueMedicationAdministration);
      }

      const response = await apiClient.get('/nursing/medications/due_now/');
      // Ensure we always return an array
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    refetchInterval: 60000, // Refetch every minute
  });
};

export const useOverdueMedications = () => {
  return useQuery({
    queryKey: nursingKeys.medicationsOverdue(),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const rows = await getV2MedicationAdministrations({ status: 'scheduled' }, { signal });
        return rows.filter(isDueMedicationAdministration);
      }

      const response = await apiClient.get('/nursing/medications/overdue/');
      // Ensure we always return an array
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    refetchInterval: 60000, // Refetch every minute
  });
};

export const useCreateMedicationAdministration = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postMedicationAdministrations(
            normalizeV2MedicationAdministrationPayload(data),
            { signal: data?.signal },
          );
          return adaptV2MedicationAdministration(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to schedule medication administration');
        }
      }

      const response = await apiClient.post('/nursing/medications/', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationAdministrationsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationsDueNow() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
    },
  });
};

export const useAdministerMedication = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ medicationId, data, signal }) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postMedicationAdministrationAdminister(
            { id: medicationId },
            normalizeV2MedicationAdministerPayload(data),
            { signal: signal || data?.signal },
          );
          return adaptV2MedicationAdministration(response?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to administer medication');
        }
      }

      const response = await apiClient.post(`/nursing/medications/${medicationId}/administer/`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationAdministrationsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationsDueNow() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationsOverdue() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.marGridAll() });
    },
  });
};

export const useCreateAndAdminister = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      if (isRustV2ApiMode()) {
        try {
          const created = await v2Api.postMedicationAdministrations(
            normalizeV2MedicationAdministrationPayload(data),
            { signal: data?.signal },
          );
          const createdAdministration = adaptV2MedicationAdministration(created?.data);
          const administered = await v2Api.postMedicationAdministrationAdminister(
            { id: createdAdministration.id },
            normalizeV2MedicationAdministerPayload(data),
            { signal: data?.signal },
          );
          return adaptV2MedicationAdministration(administered?.data);
        } catch (error) {
          rethrowV2Error(error, 'Failed to create and administer medication');
        }
      }

      // data: { patient_id, prescription_id, scheduled_time, notes? }
      const response = await apiClient.post('/nursing/medications/create-and-administer/', data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationAdministrationsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationsDueNow() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationsOverdue() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.marGridAll() });
    },
  });
};

// ========== Patient MAR (Medication Administration Record) ==========

export const usePatientMAR = (patientId, date = null) => {
  return useQuery({
    queryKey: nursingKeys.patientMar(patientId, date),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        const records = await getV2MedicationAdministrations({ patient: patientId, date }, { signal });
        return buildPatientMAR(records, patientId, date);
      }

      const params = new URLSearchParams();
      params.append('patient', patientId);
      if (date) params.append('date', date);
      const response = await apiClient.getWithPagination(`/nursing/medications/patient_mar/?${params.toString()}`, { signal });
      return response;
    },
    enabled: !!patientId,
    refetchInterval: 60000,
    staleTime: 30000,
  });
};

export const useGenerateMAR = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ prescriptionId, days = 7, startDate = null }) => {
      if (isRustV2ApiMode()) {
        throw new Error('Rust V2 does not expose MAR generation yet.');
      }

      const data = { days };
      if (startDate) data.start_date = startDate;
      const response = await apiClient.post(`/clinical-notes/prescriptions/${prescriptionId}/generate_mar/`, data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationAdministrationsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMarAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationsDueNow() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() });
    },
  });
};

// ========== Pharmacy Dispensing ==========
// These endpoints use the pharmacy module at /api/pharmacy/dispensing/

export const usePendingDispensing = (patientId = null) => {
  return useQuery({
    queryKey: nursingKeys.pendingDispensing(patientId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2PendingPharmacyQueue({ signal });
      }
      const params = patientId ? `?patient=${patientId}` : '';
      const response = await apiClient.get(`/pharmacy/dispensing/pending/${params}`);
      return response;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const usePendingDispensingGrouped = (patientId = null) => {
  return useQuery({
    queryKey: nursingKeys.pendingDispensingGrouped(patientId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2PendingPharmacyQueue({ signal });
      }
      const params = patientId ? `?patient=${patientId}` : '';
      const response = await apiClient.get(`/pharmacy/dispensing/pending-grouped/${params}`);
      return response;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useReadyForAdmin = (patientId = null) => {
  return useQuery({
    queryKey: nursingKeys.readyForAdmin(patientId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2PendingPharmacyQueue({ signal });
      }
      const params = patientId ? `?patient=${patientId}` : '';
      const response = await apiClient.get(`/pharmacy/dispensing/ready-for-admin/${params}`);
      return response;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useDispenseMedication = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (medicationId) => {
      if (isRustV2ApiMode()) {
        throw new Error('Rust V2 does not expose pharmacy dispense actions from the nursing queue yet.');
      }

      const response = await apiClient.post(`/pharmacy/dispensing/${medicationId}/dispense/`, {});
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.pendingDispensingAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.readyForAdminAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationAdministrationsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMarAll() });
    },
  });
};

export const useBulkDispense = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (medicationIds) => {
      if (isRustV2ApiMode()) {
        throw new Error('Rust V2 does not expose pharmacy bulk dispense actions from the nursing queue yet.');
      }

      const response = await apiClient.post('/pharmacy/dispensing/bulk-dispense/', {
        medication_ids: medicationIds,
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.pendingDispensingAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.readyForAdminAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationAdministrationsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMarAll() });
    },
  });
};

// ========== MAR Grid ==========

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
    refetchInterval: () => !document.hidden ? 60000 : false, // 1 minute
    refetchOnWindowFocus: true,
    staleTime: 30000, // 30 seconds
  });
};

// ========== Treatment Sheet ==========

export const useTreatmentSheetByAdmission = (admissionId) => {
  return useQuery({
    queryKey: nursingKeys.treatmentSheet(admissionId),
    queryFn: async ({ signal }) => {
      if (isRustV2ApiMode()) {
        return getV2TreatmentSheets({ admission: admissionId }, { signal });
      }

      const response = await apiClient.get(`/nursing/treatment-sheet/by-admission/?admission_id=${admissionId}`);
      // Ensure we always return an array
      return response.data || response || [];
    },
    enabled: !!admissionId,
    refetchInterval: () => !document.hidden ? 120000 : false, // 2 minutes
    refetchOnWindowFocus: true,
    staleTime: 60000, // 1 minute
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
      // apiClient.get returns data directly, not response.data
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
    refetchInterval: () => !document.hidden ? 120000 : false, // 2 minutes
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
      // apiClient.get returns data directly, not response.data
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

// ========== Supply Requests ==========

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
    refetchInterval: () => !document.hidden ? 60000 : false, // 1 minute for pharmacy
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
      // apiClient.get returns data directly, not response.data
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

// ========== Fluid Balance ==========

/**
 * Get fluid balance entries for a patient
 * @param {string} patientId - Patient ID
 * @param {Object} filters - Optional filters (entry_type, date, start_date, end_date)
 * @param {Object} options - Query options including enabled
 */
export const useFluidBalance = (patientId, filters = {}, options = {}) => {
  const { enabled = true } = options;
  // Extract filter values to use as stable primitives in query key
  const { admission, admission_id, entry_type, date, start_date, end_date } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls from object reference changes
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
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      // Handle paginated response (results array) or direct array
      return data?.results ?? data ?? [];
    },
    enabled: !!patientId && enabled,
    refetchInterval: false, // Disable polling - manually refresh when needed
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
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? { total_intake: 0, total_output: 0, balance: 0 };
    },
    enabled: !!patientId && enabled,
    refetchInterval: false, // Disable polling - manually refresh when needed
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
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? { total_intake: 0, total_output: 0, balance: 0 };
    },
    enabled: !!patientId && enabled,
    refetchInterval: false, // Disable polling - manually refresh when needed
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
      // apiClient.post returns data directly, not response.data
      return response?.data ?? response;
    },
    onSuccess: (data) => {
      // Invalidate all fluid balance queries for this patient
      if (data?.patient) {
        queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceAll() });
        queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceSummaryAll() });
        queryClient.invalidateQueries({ queryKey: nursingKeys.fluidBalanceTodayAll() });
      }
      // Also invalidate general fluid balance queries
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
    staleTime: 300000, // 5 minutes - settings don't change often
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
