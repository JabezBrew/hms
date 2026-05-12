import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { v2Api } from '@/lib/api/v2/client';
import { handleV2ApiError } from '@/lib/api/v2/errors';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { keyWith } from '@/shared/lib/queryKeys';

const MAX_MONITORING_PAGE_SIZE = 50;
const MAX_VITALS_PAGE_SIZE = 50;

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function rethrowV2Error(error, message) {
  rethrowAbortError(error);
  throw new Error(handleV2ApiError(error, message));
}

function repeatedItems(count, factory) {
  const safeCount = Math.max(0, Number.parseInt(count, 10) || 0);
  return Array.from({ length: safeCount }, (_, index) => factory(index));
}

function adaptV2WardBoardMonitoringItem(item = {}) {
  const patientName = item.patient_display_name || item.patient_name || item.name || 'Unknown Patient';
  const bedNumber = item.bed_code || item.bed_number || '';

  return {
    patient: {
      id: item.patient_id,
      medical_record_number: item.patient_code || '',
      user: {
        full_name: patientName,
      },
      user_details: {
        full_name: patientName,
      },
    },
    admission: {
      id: item.admission_id,
      status: item.admission_status,
      admitted_at: item.admitted_at,
      bed_details: {
        id: item.bed_id ?? null,
        bed_number: bedNumber,
        ward_details: {
          id: item.ward_id,
          name: item.ward_name || '',
        },
      },
    },
    latest_vitals: null,
    active_alerts: [],
    pending_tasks: repeatedItems(item.open_nursing_task_count, (index) => ({
      id: `${item.admission_id || item.patient_id}-task-${index + 1}`,
      status: 'open',
    })),
    medications_due: repeatedItems(item.due_medication_count, (index) => ({
      id: `${item.admission_id || item.patient_id}-med-${index + 1}`,
      status: 'scheduled',
    })),
  };
}

function adaptV2NursingAlert(item = {}) {
  const patientName = item.patient_display_name || 'Unknown Patient';
  return {
    ...item,
    alert_type: 'nursing_alert',
    message: item.title || 'Nursing alert',
    acknowledged: Boolean(item.acknowledged_at) || item.status === 'acknowledged',
    patient_details: {
      id: item.patient_id,
      medical_record_number: item.patient_code || '',
      user_details: {
        full_name: patientName,
      },
    },
  };
}

function adaptV2PatientVitals(item = {}) {
  return {
    ...item,
    patient: item.patient_id,
    admission: item.admission_case_id,
    temperature: item.temperature_c,
    heart_rate: item.pulse,
    spo2: item.oxygen_saturation,
    oxygen_saturation: item.oxygen_saturation,
    blood_pressure_systolic: item.systolic_bp,
    blood_pressure_diastolic: item.diastolic_bp,
  };
}

function normalizeVitalSignsLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 25;
  }
  return Math.min(parsed, MAX_VITALS_PAGE_SIZE);
}

async function getV2PatientVitals(filters = {}, { signal } = {}) {
  const patientId = filters.patient_id || filters.patient;
  const query = {
    limit: normalizeVitalSignsLimit(filters.limit),
  };
  if (patientId) {
    query.patient_id = patientId;
  }
  if (filters.hours !== undefined && filters.hours !== null && filters.hours !== '') {
    query.hours = filters.hours;
  }
  try {
    const response = await v2Api.getPatientVitals({
      query,
      signal,
    });
    const rows = (response?.data ?? []).map(adaptV2PatientVitals);
    if (filters.ordering === '-recorded_at') {
      return rows.sort((left, right) => new Date(right.recorded_at) - new Date(left.recorded_at));
    }
    return rows;
  } catch (error) {
    rethrowV2Error(error, 'Failed to load patient vital signs');
  }
}

async function getV2PendingPharmacyQueue({ signal } = {}) {
  try {
    await v2Api.getPharmacyDispenses({
      query: { limit: 50 },
      signal,
    });
    // Rust V2 currently exposes completed pharmacy dispenses, not a pending
    // prescription dispensing queue. Do not surface completed dispenses as work.
    return [];
  } catch (error) {
    rethrowV2Error(error, 'Failed to load pharmacy dispensing queue');
  }
}

export const nursingKeys = {
  patientMonitoring: (wardId, page, pageSize) => keyWith('patient-monitoring', wardId, page, pageSize),
  patientMonitoringAll: () => keyWith('patient-monitoring'),
  patientDetail: (patientId) => keyWith('patient-detail', patientId),
  vitalSigns: (patient, admission, encounter, date, startDate, endDate) =>
    keyWith('vital-signs', patient, admission, encounter, date, startDate, endDate),
  vitalSignsWindow: (patientId, window) => keyWith('vital-signs', patientId, window),
  vitalSignsAll: () => keyWith('vital-signs'),
  vitalSignsTrends: (patientId, days, encounterId, admissionId, startDate, endDate) =>
    keyWith('vital-signs-trends', patientId, days, encounterId, admissionId, startDate, endDate),
  vitalSignsTrendsByPatient: (patientId) => keyWith('vital-signs-trends', patientId),
  nursingTasks: (patient, status, ward, date) => keyWith('nursing-tasks', patient, status, ward, date),
  nursingTasksAll: () => keyWith('nursing-tasks'),
  nursingTasksToday: () => keyWith('nursing-tasks-today'),
  nursingAlerts: (patient, ward, severity, status) => keyWith('nursing-alerts', patient, ward, severity, status),
  nursingAlertsAll: () => keyWith('nursing-alerts'),
  nursingAlertsActive: () => keyWith('nursing-alerts-active'),
  medicationAdministrations: (patient, admission, date, status) =>
    keyWith('medication-administrations', patient, admission, date, status),
  medicationAdministrationsAll: () => keyWith('medication-administrations'),
  medicationsDueNow: () => keyWith('medications-due-now'),
  medicationsOverdue: () => keyWith('medications-overdue'),
  medicationAdministrationHistory: (patient, status, startDate, endDate, ordering, page, pageSize) =>
    keyWith('medication-administration-history', patient, status, startDate, endDate, ordering, page, pageSize),
  patientMar: (patientId, date) => keyWith('patient-mar', patientId, date),
  patientMarAll: () => keyWith('patient-mar'),
  marGrid: (admissionId, startDate, days) => keyWith('mar-grid', admissionId, startDate, days),
  marGridAll: () => keyWith('mar-grid'),
  pendingDispensing: (patientId) => keyWith('pending-dispensing', patientId),
  pendingDispensingAll: () => keyWith('pending-dispensing'),
  pendingDispensingGrouped: (patientId) => keyWith('pending-dispensing', 'grouped', patientId),
  readyForAdmin: (patientId) => keyWith('ready-for-admin', patientId),
  readyForAdminAll: () => keyWith('ready-for-admin'),
  shiftHandoffs: (ward, date, shift) => keyWith('shift-handoffs', ward, date, shift),
  shiftHandoffsAll: () => keyWith('shift-handoffs'),
  shiftHandoffsToday: () => keyWith('shift-handoffs-today'),
  treatmentSheet: (admissionId) => keyWith('treatment-sheet', admissionId),
  treatmentSheetAll: () => keyWith('treatment-sheet'),
  treatmentSheetEntry: (entryId) => keyWith('treatment-sheet-entry', entryId),
  treatmentSheetLowSupply: () => keyWith('treatment-sheet-low-supply'),
  supplyStatus: (entryId) => keyWith('supply-status', entryId),
  supplyRequests: (status) => keyWith('supply-requests', status),
  supplyRequestsAll: () => keyWith('supply-requests'),
  supplyRequest: (requestId) => keyWith('supply-request', requestId),
  fluidBalance: (patientId, admissionId, entryType, date, startDate, endDate) =>
    keyWith('fluid-balance', patientId, admissionId, entryType, date, startDate, endDate),
  fluidBalanceAll: () => keyWith('fluid-balance'),
  fluidBalanceTrends: (patientId, admissionId, startDate, endDate) =>
    keyWith('fluid-balance-trends', patientId, admissionId, startDate, endDate),
  fluidBalanceSummary: (patientId, date) => keyWith('fluid-balance-summary', patientId, date),
  fluidBalanceSummaryAll: () => keyWith('fluid-balance-summary'),
  fluidBalanceToday: (patientId) => keyWith('fluid-balance-today', patientId),
  fluidBalanceTodayAll: () => keyWith('fluid-balance-today'),
  fluidBalanceSettings: () => keyWith('fluid-balance-settings'),
  fluidBalanceAlerts: (patientId, date) => keyWith('fluid-balance-alerts', patientId, date),
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
      const data = await apiClient.getWithPagination(`/nursing/monitoring/dashboard/?${params.toString()}`);

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

export const usePatientDetail = (patientId) => {
  return useQuery({
    queryKey: nursingKeys.patientDetail(patientId),
    queryFn: async () => {
      const response = await apiClient.get(`/nursing/monitoring/patient_detail/?patient=${patientId}`);
      // Ensure we always return an object
      const data = response?.data ?? response;
      return data || {};
    },
    enabled: !!patientId,
    placeholderData: {},
    refetchInterval: () => !document.hidden ? 60000 : false,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    staleTime: 30000,
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
  const { patient, status, ward, date } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls
    queryKey: nursingKeys.nursingTasks(patient, status, ward, date),
    queryFn: async () => {
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
    queryFn: async () => {
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
    mutationFn: async ({ taskId, data }) => {
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
    mutationFn: async ({ taskId, data }) => {
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
    queryFn: async () => {
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
        try {
          const response = await v2Api.getNursingAlerts({
            query: { limit: 50 },
            signal,
          });
          return (Array.isArray(response?.data) ? response.data : [])
            .map(adaptV2NursingAlert)
            .filter((alert) => !alert.acknowledged && alert.status !== 'resolved');
        } catch (error) {
          rethrowV2Error(error, 'Failed to load active nursing alerts');
        }
      }

      // Use getWithPagination to avoid auto-extraction of results
      const data = await apiClient.getWithPagination('/nursing/alerts/active/');

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
    mutationFn: async ({ alertId, notes }) => {
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
    queryFn: async () => {
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
    queryFn: async () => {
      const params = new URLSearchParams();
      if (patient) params.append('patient', patient);
      if (status && status !== 'all') params.append('status', status);
      if (start_date) params.append('start_date', start_date);
      if (end_date) params.append('end_date', end_date);
      if (ordering) params.append('ordering', ordering);
      params.append('page', String(page));
      params.append('page_size', String(page_size));

      const response = await apiClient.getWithPagination(`/nursing/medications/?${params.toString()}`);

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
    queryFn: async () => {
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
    queryFn: async () => {
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
    mutationFn: async ({ medicationId, data }) => {
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
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('patient', patientId);
      if (date) params.append('date', date);
      const response = await apiClient.getWithPagination(`/nursing/medications/patient_mar/?${params.toString()}`);
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

// ========== Shift Handoffs ==========

export const useShiftHandoffs = (filters = {}) => {
  // Extract filter values to use as stable primitives in query key
  const { ward, date, shift } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls
    queryKey: nursingKeys.shiftHandoffs(ward, date, shift),
    queryFn: async () => {
      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/handoffs/?${params.toString()}`);
      // apiClient.get returns data directly, not response.data
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
    queryFn: async () => {
      const response = await apiClient.get('/nursing/handoffs/today/');
      // apiClient.get returns data directly or response.data depending on implementation
      // Ensure we always return an array (not undefined)
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
    mutationFn: async ({ handoffId, data }) => {
      const response = await apiClient.patch(`/nursing/handoffs/${handoffId}/`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nursingKeys.shiftHandoffsAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.shiftHandoffsToday() });
    },
  });
};

// ========== MAR Grid ==========

export const useMARGrid = (admissionId, startDate = null, days = 7) => {
  return useQuery({
    queryKey: nursingKeys.marGrid(admissionId, startDate, days),
    queryFn: async () => {
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
    queryFn: async () => {
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
    queryFn: async () => {
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
    mutationFn: async ({ entryId, quantity, notes }) => {
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
    queryFn: async () => {
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
    queryFn: async () => {
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
    mutationFn: async ({ requestId, quantityDispensed }) => {
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
    mutationFn: async (requestIds) => {
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
      const response = await apiClient.get('/settings/fluid-balance/');
      const data = response?.data ?? response;
      return data ?? {
        min_daily_intake_target: 1500,
        max_daily_output_threshold: 3000,
        negative_balance_alert_threshold: -500,
        positive_balance_alert_threshold: 2000,
        enable_intake_alerts: true,
        enable_output_alerts: true,
        enable_balance_alerts: true,
      };
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
    queryFn: async () => {
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
