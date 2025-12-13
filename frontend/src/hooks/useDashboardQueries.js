import { useQuery } from '@tanstack/react-query';
import { dashboardsApi } from '@/lib/api/dashboards';

// Query keys
export const dashboardKeys = {
  all: ['dashboards'],
  nurse: (filters) => [...dashboardKeys.all, 'nurse', { filters }],
  inpatient: () => [...dashboardKeys.all, 'inpatient'],
  receptionist: () => [...dashboardKeys.all, 'receptionist'],
  admin: () => [...dashboardKeys.all, 'admin'],
  myWork: (filters) => [...dashboardKeys.all, 'my-work', { filters }],
  clinic: (filters) => [...dashboardKeys.all, 'clinic', { filters }],
};

// Default polling interval (30 seconds)
const DEFAULT_REFETCH_INTERVAL = 30000;

/**
 * Get nurse dashboard data with real-time polling
 * @param {Object} filters - Query parameters (ward, etc.)
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useNurseDashboard(filters = {}, options = {}) {
  return useQuery({
    queryKey: dashboardKeys.nurse(filters),
    queryFn: () => dashboardsApi.getNurseDashboard(filters),
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    refetchIntervalInBackground: false, // Only poll when tab is active
    staleTime: 10000, // Consider data stale after 10 seconds
    ...options,
  });
}

/**
 * Get inpatient doctor dashboard data with real-time polling
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useInpatientDashboard(options = {}) {
  return useQuery({
    queryKey: dashboardKeys.inpatient(),
    queryFn: () => dashboardsApi.getInpatientDashboard(),
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
  });
}

/**
 * Get receptionist dashboard data with real-time polling
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useReceptionistDashboard(options = {}) {
  return useQuery({
    queryKey: dashboardKeys.receptionist(),
    queryFn: () => dashboardsApi.getReceptionistDashboard(),
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
  });
}

/**
 * Get admin dashboard data with real-time polling
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useAdminDashboard(options = {}) {
  return useQuery({
    queryKey: dashboardKeys.admin(),
    queryFn: () => dashboardsApi.getAdminDashboard(),
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
  });
}

/**
 * Get outpatient doctor dashboard data (my work) with real-time polling
 * @param {Object} filters - Query parameters (date, etc.)
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useMyWorkDashboard(filters = {}, options = {}) {
  return useQuery({
    queryKey: dashboardKeys.myWork(filters),
    queryFn: () => dashboardsApi.getMyWorkDashboard(filters),
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
  });
}

/**
 * Get clinic schedule dashboard data with real-time polling
 * @param {Object} filters - Query parameters (date, practitioner_id, etc.)
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useClinicSchedule(filters = {}, options = {}) {
  return useQuery({
    queryKey: dashboardKeys.clinic(filters),
    queryFn: () => dashboardsApi.getClinicSchedule(filters),
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
  });
}
