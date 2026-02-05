import { useQuery } from '@tanstack/react-query';
import { dashboardsApi } from '@/features/dashboards/api';
import { useAuth } from '@/lib/auth';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';

// Query keys
const dashboardKeyFactory = createKeyFactory('dashboards');

export const dashboardKeys = {
  all: dashboardKeyFactory.all,
  nurse: (filters) => keyWith('dashboards', 'nurse', { filters }),
  inpatient: () => keyWith('dashboards', 'inpatient'),
  receptionist: () => keyWith('dashboards', 'receptionist'),
  admin: () => keyWith('dashboards', 'admin'),
  myWork: (filters) => keyWith('dashboards', 'my-work', { filters }),
  clinic: (filters) => keyWith('dashboards', 'clinic', { filters }),
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
  const { facilityCode } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.nurse(filters),
    queryFn: () => dashboardsApi.getNurseDashboard(filters),
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    refetchIntervalInBackground: false, // Only poll when tab is active
    staleTime: 10000, // Consider data stale after 10 seconds
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode),
  });
}

/**
 * Get inpatient doctor dashboard data with real-time polling
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useInpatientDashboard(options = {}) {
  const { facilityCode } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.inpatient(),
    queryFn: () => dashboardsApi.getInpatientDashboard(),
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode),
  });
}

/**
 * Get receptionist dashboard data with real-time polling
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useReceptionistDashboard(options = {}) {
  const { facilityCode } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.receptionist(),
    queryFn: () => dashboardsApi.getReceptionistDashboard(),
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode),
  });
}

/**
 * Get admin dashboard data with real-time polling
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useAdminDashboard(options = {}) {
  const { facilityCode } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.admin(),
    queryFn: () => dashboardsApi.getAdminDashboard(),
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode),
  });
}

/**
 * Get outpatient doctor dashboard data (my work) with real-time polling
 * @param {Object} filters - Query parameters (date, etc.)
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useMyWorkDashboard(filters = {}, options = {}) {
  const { facilityCode } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.myWork(filters),
    queryFn: () => dashboardsApi.getMyWorkDashboard(filters),
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode),
  });
}

/**
 * Get clinic schedule dashboard data with real-time polling
 * @param {Object} filters - Query parameters (date, practitioner_id, etc.)
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useClinicSchedule(filters = {}, options = {}) {
  const { facilityCode } = useAuth();
  return useQuery({
    queryKey: dashboardKeys.clinic(filters),
    queryFn: () => dashboardsApi.getClinicSchedule(filters),
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode),
  });
}
