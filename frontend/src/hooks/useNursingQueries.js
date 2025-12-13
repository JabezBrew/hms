import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

// ========== Patient Monitoring ==========

export const usePatientMonitoring = (wardId = null, page = 1, pageSize = 20) => {
  return useQuery({
    queryKey: ['patient-monitoring', wardId, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (wardId) params.append('ward', wardId);
      params.append('page', page.toString());
      params.append('page_size', pageSize.toString());

      // Use getWithPagination to get the full paginated response, not just results
      const data = await apiClient.getWithPagination(`/nursing/monitoring/dashboard/?${params.toString()}`);

      // Handle both array and paginated object responses
      if (!data) {
        return {
          count: 0,
          page: 1,
          page_size: pageSize,
          total_pages: 0,
          results: []
        };
      }

      // If backend returns array directly (not paginated), wrap it
      if (Array.isArray(data)) {
        return {
          count: data.length,
          page: page,
          page_size: pageSize,
          total_pages: Math.ceil(data.length / pageSize),
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
      page_size: pageSize,
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
    queryKey: ['patient-detail', patientId],
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

export const useVitalSigns = (filters = {}) => {
  return useQuery({
    queryKey: ['vital-signs', filters],
    queryFn: async () => {
      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/vital-signs/?${params.toString()}`);
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? [];
    },
    placeholderData: [],
  });
};

export const useVitalSignsTrends = (patientId, days = 7) => {
  return useQuery({
    queryKey: ['vital-signs-trends', patientId, days],
    queryFn: async () => {
      const response = await apiClient.get(`/nursing/vital-signs/patient_trends/?patient=${patientId}&days=${days}`);
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? [];
    },
    enabled: !!patientId,
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
      queryClient.invalidateQueries({ queryKey: ['vital-signs'] });
      queryClient.invalidateQueries({ queryKey: ['vital-signs-trends', data?.patient] });
      queryClient.invalidateQueries({ queryKey: ['patient-monitoring'] });
      queryClient.invalidateQueries({ queryKey: ['patient-detail', data?.patient] });
    },
  });
};

// ========== Nursing Tasks ==========

export const useNursingTasks = (filters = {}) => {
  return useQuery({
    queryKey: ['nursing-tasks', filters],
    queryFn: async () => {
      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/tasks/?${params.toString()}`);
      // Ensure we always return an array
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
  });
};

export const useTodayTasks = () => {
  return useQuery({
    queryKey: ['nursing-tasks-today'],
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
      queryClient.invalidateQueries({ queryKey: ['nursing-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['nursing-tasks-today'] });
      queryClient.invalidateQueries({ queryKey: ['patient-monitoring'] });
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
      queryClient.invalidateQueries({ queryKey: ['nursing-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['nursing-tasks-today'] });
      queryClient.invalidateQueries({ queryKey: ['patient-monitoring'] });
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
      queryClient.invalidateQueries({ queryKey: ['nursing-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['nursing-tasks-today'] });
    },
  });
};

// ========== Nursing Alerts ==========

export const useNursingAlerts = (filters = {}) => {
  return useQuery({
    queryKey: ['nursing-alerts', filters],
    queryFn: async () => {
      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/alerts/?${params.toString()}`);
      // Ensure we always return an array
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
    refetchInterval: () => !document.hidden ? 45000 : false, // 45 seconds when focused
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    staleTime: 20000,
  });
};

export const useActiveAlerts = () => {
  return useQuery({
    queryKey: ['nursing-alerts-active'],
    queryFn: async () => {
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
      queryClient.invalidateQueries({ queryKey: ['nursing-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['nursing-alerts-active'] });
      queryClient.invalidateQueries({ queryKey: ['patient-monitoring'] });
    },
  });
};

// ========== Medication Administration ==========

export const useMedicationAdministrations = (filters = {}) => {
  return useQuery({
    queryKey: ['medication-administrations', filters],
    queryFn: async () => {
      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/medications/?${params.toString()}`);
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
  });
};

export const useMedicationsDueNow = () => {
  return useQuery({
    queryKey: ['medications-due-now'],
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
    queryKey: ['medications-overdue'],
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
      queryClient.invalidateQueries({ queryKey: ['medication-administrations'] });
      queryClient.invalidateQueries({ queryKey: ['medications-due-now'] });
      queryClient.invalidateQueries({ queryKey: ['patient-monitoring'] });
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
      queryClient.invalidateQueries({ queryKey: ['medication-administrations'] });
      queryClient.invalidateQueries({ queryKey: ['medications-due-now'] });
      queryClient.invalidateQueries({ queryKey: ['medications-overdue'] });
      queryClient.invalidateQueries({ queryKey: ['patient-monitoring'] });
      queryClient.invalidateQueries({ queryKey: ['mar-grid'] });
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
      queryClient.invalidateQueries({ queryKey: ['medication-administrations'] });
      queryClient.invalidateQueries({ queryKey: ['medications-due-now'] });
      queryClient.invalidateQueries({ queryKey: ['medications-overdue'] });
      queryClient.invalidateQueries({ queryKey: ['patient-monitoring'] });
      queryClient.invalidateQueries({ queryKey: ['mar-grid'] });
    },
  });
};

// ========== Patient MAR (Medication Administration Record) ==========

export const usePatientMAR = (patientId, date = null) => {
  return useQuery({
    queryKey: ['patient-mar', patientId, date],
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
      queryClient.invalidateQueries({ queryKey: ['medication-administrations'] });
      queryClient.invalidateQueries({ queryKey: ['patient-mar'] });
      queryClient.invalidateQueries({ queryKey: ['medications-due-now'] });
      queryClient.invalidateQueries({ queryKey: ['patient-monitoring'] });
    },
  });
};

// ========== Pharmacy Dispensing ==========

export const usePendingDispensing = (patientId = null) => {
  return useQuery({
    queryKey: ['pending-dispensing', patientId],
    queryFn: async () => {
      const params = patientId ? `?patient=${patientId}` : '';
      const response = await apiClient.get(`/nursing/medications/pending_dispensing/${params}`);
      return response;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
};

export const useReadyForAdmin = (patientId = null) => {
  return useQuery({
    queryKey: ['ready-for-admin', patientId],
    queryFn: async () => {
      const params = patientId ? `?patient=${patientId}` : '';
      const response = await apiClient.get(`/nursing/medications/ready_for_admin/${params}`);
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
      const response = await apiClient.post(`/nursing/medications/${medicationId}/dispense/`, {});
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-dispensing'] });
      queryClient.invalidateQueries({ queryKey: ['ready-for-admin'] });
      queryClient.invalidateQueries({ queryKey: ['medication-administrations'] });
      queryClient.invalidateQueries({ queryKey: ['patient-mar'] });
    },
  });
};

export const useBulkDispense = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (medicationIds) => {
      const response = await apiClient.post('/nursing/medications/dispense_bulk/', {
        medication_ids: medicationIds,
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-dispensing'] });
      queryClient.invalidateQueries({ queryKey: ['ready-for-admin'] });
      queryClient.invalidateQueries({ queryKey: ['medication-administrations'] });
      queryClient.invalidateQueries({ queryKey: ['patient-mar'] });
    },
  });
};

// ========== Shift Handoffs ==========

export const useShiftHandoffs = (filters = {}) => {
  return useQuery({
    queryKey: ['shift-handoffs', filters],
    queryFn: async () => {
      const params = new URLSearchParams(filters);
      const response = await apiClient.get(`/nursing/handoffs/?${params.toString()}`);
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return Array.isArray(data) ? data : [];
    },
    placeholderData: [],
  });
};

export const useTodayHandoffs = () => {
  return useQuery({
    queryKey: ['shift-handoffs-today'],
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
      queryClient.invalidateQueries({ queryKey: ['shift-handoffs'] });
      queryClient.invalidateQueries({ queryKey: ['shift-handoffs-today'] });
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
      queryClient.invalidateQueries({ queryKey: ['shift-handoffs'] });
      queryClient.invalidateQueries({ queryKey: ['shift-handoffs-today'] });
    },
  });
};

// ========== MAR Grid ==========

export const useMARGrid = (admissionId, startDate = null, days = 7) => {
  return useQuery({
    queryKey: ['mar-grid', admissionId, startDate, days],
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
    queryKey: ['treatment-sheet', admissionId],
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
    queryKey: ['treatment-sheet-entry', entryId],
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
    queryKey: ['treatment-sheet-low-supply'],
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
    queryKey: ['supply-status', entryId],
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
      queryClient.invalidateQueries({ queryKey: ['treatment-sheet'] });
      queryClient.invalidateQueries({ queryKey: ['treatment-sheet', data.admission] });
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
      queryClient.invalidateQueries({ queryKey: ['treatment-sheet'] });
      queryClient.invalidateQueries({ queryKey: ['treatment-sheet-entry', data.id] });
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
      queryClient.invalidateQueries({ queryKey: ['treatment-sheet'] });
      queryClient.invalidateQueries({ queryKey: ['treatment-sheet-entry', variables.entryId] });
      queryClient.invalidateQueries({ queryKey: ['supply-requests'] });
      queryClient.invalidateQueries({ queryKey: ['supply-status', variables.entryId] });
    },
  });
};

// ========== Supply Requests ==========

export const usePendingSupplyRequests = () => {
  return useQuery({
    queryKey: ['supply-requests', 'pending'],
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
    queryKey: ['supply-request', requestId],
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
      queryClient.invalidateQueries({ queryKey: ['supply-requests'] });
      queryClient.invalidateQueries({ queryKey: ['supply-request', data.id] });
      queryClient.invalidateQueries({ queryKey: ['treatment-sheet'] });
      queryClient.invalidateQueries({ queryKey: ['treatment-sheet-low-supply'] });
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
      queryClient.invalidateQueries({ queryKey: ['supply-requests'] });
      queryClient.invalidateQueries({ queryKey: ['supply-request', data.id] });
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
      queryClient.invalidateQueries({ queryKey: ['supply-requests'] });
      queryClient.invalidateQueries({ queryKey: ['treatment-sheet'] });
      queryClient.invalidateQueries({ queryKey: ['treatment-sheet-low-supply'] });
    },
  });
};

// ========== Fluid Balance ==========

/**
 * Get fluid balance entries for a patient
 * @param {string} patientId - Patient ID
 * @param {Object} filters - Optional filters (entry_type, date, start_date, end_date)
 */
export const useFluidBalance = (patientId, filters = {}) => {
  return useQuery({
    queryKey: ['fluid-balance', patientId, filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (patientId) params.append('patient', patientId);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.append(key, value);
      });
      const response = await apiClient.get(`/nursing/fluid-balance/?${params.toString()}`);
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      // Handle paginated response (results array) or direct array
      return data?.results ?? data ?? [];
    },
    enabled: !!patientId,
    refetchInterval: () => !document.hidden ? 60000 : false,
    refetchOnWindowFocus: true,
    staleTime: 30000,
    placeholderData: [],
  });
};

/**
 * Get fluid balance summary/totals for a patient on a specific date
 * @param {string} patientId - Patient ID
 * @param {string} date - Optional date (YYYY-MM-DD format, defaults to today)
 */
export const useFluidBalanceSummary = (patientId, date = null) => {
  return useQuery({
    queryKey: ['fluid-balance-summary', patientId, date],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('patient', patientId);
      if (date) params.append('date', date);
      const response = await apiClient.get(`/nursing/fluid-balance/patient_summary/?${params.toString()}`);
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? { total_intake: 0, total_output: 0, balance: 0 };
    },
    enabled: !!patientId,
    refetchInterval: () => !document.hidden ? 60000 : false,
    refetchOnWindowFocus: true,
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
 */
export const useTodayFluidBalance = (patientId) => {
  return useQuery({
    queryKey: ['fluid-balance-today', patientId],
    queryFn: async () => {
      const response = await apiClient.get(`/nursing/fluid-balance/today_balance/?patient=${patientId}`);
      // apiClient.get returns data directly, not response.data
      const data = response?.data ?? response;
      return data ?? { total_intake: 0, total_output: 0, balance: 0 };
    },
    enabled: !!patientId,
    refetchInterval: () => !document.hidden ? 60000 : false,
    refetchOnWindowFocus: true,
    staleTime: 30000,
    placeholderData: {
      total_intake: 0,
      total_output: 0,
      balance: 0,
    },
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
        queryClient.invalidateQueries({ queryKey: ['fluid-balance', data.patient] });
        queryClient.invalidateQueries({ queryKey: ['fluid-balance-summary', data.patient] });
        queryClient.invalidateQueries({ queryKey: ['fluid-balance-today', data.patient] });
      }
      // Also invalidate general fluid balance queries
      queryClient.invalidateQueries({ queryKey: ['fluid-balance'] });
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
      queryClient.invalidateQueries({ queryKey: ['fluid-balance'] });
      queryClient.invalidateQueries({ queryKey: ['fluid-balance-summary'] });
      queryClient.invalidateQueries({ queryKey: ['fluid-balance-today'] });
    },
  });
};

/**
 * Get fluid balance alert settings (facility-level thresholds)
 */
export const useFluidBalanceSettings = () => {
  return useQuery({
    queryKey: ['fluid-balance-settings'],
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
    queryKey: ['fluid-balance-alerts', patientId, date],
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
