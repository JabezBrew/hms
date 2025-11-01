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
    refetchInterval: (data) => {
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
      return response.data;
    },
    enabled: !!patientId,
    refetchInterval: (data) => !document.hidden ? 60000 : false,
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
      return response.data;
    },
  });
};

export const useVitalSignsTrends = (patientId, days = 7) => {
  return useQuery({
    queryKey: ['vital-signs-trends', patientId, days],
    queryFn: async () => {
      const response = await apiClient.get(`/nursing/vital-signs/patient_trends/?patient=${patientId}&days=${days}`);
      return response.data;
    },
    enabled: !!patientId,
  });
};

export const useCreateVitalSigns = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      const response = await apiClient.post('/nursing/vital-signs/', data);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['vital-signs'] });
      queryClient.invalidateQueries({ queryKey: ['vital-signs-trends', data.patient] });
      queryClient.invalidateQueries({ queryKey: ['patient-monitoring'] });
      queryClient.invalidateQueries({ queryKey: ['patient-detail', data.patient] });
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
      return response.data;
    },
  });
};

export const useTodayTasks = () => {
  return useQuery({
    queryKey: ['nursing-tasks-today'],
    queryFn: async () => {
      const response = await apiClient.get('/nursing/tasks/today/');
      return response.data;
    },
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
      return response.data;
    },
    refetchInterval: (data) => !document.hidden ? 45000 : false, // 45 seconds when focused
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
    refetchInterval: (data) => !document.hidden ? 45000 : false, // 45 seconds when focused
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
      return response.data;
    },
  });
};

export const useMedicationsDueNow = () => {
  return useQuery({
    queryKey: ['medications-due-now'],
    queryFn: async () => {
      const response = await apiClient.get('/nursing/medications/due_now/');
      return response.data;
    },
    refetchInterval: 60000, // Refetch every minute
  });
};

export const useOverdueMedications = () => {
  return useQuery({
    queryKey: ['medications-overdue'],
    queryFn: async () => {
      const response = await apiClient.get('/nursing/medications/overdue/');
      return response.data;
    },
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
      return response.data;
    },
  });
};

export const useTodayHandoffs = () => {
  return useQuery({
    queryKey: ['shift-handoffs-today'],
    queryFn: async () => {
      const response = await apiClient.get('/nursing/handoffs/today/');
      return response.data;
    },
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
