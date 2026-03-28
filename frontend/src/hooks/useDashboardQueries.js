import { useQuery } from '@tanstack/react-query';
import { dashboardsApi } from '@/features/dashboards/api';
import { useAuth } from '@/lib/auth';
import { useDoctorDashboardLiveUpdates } from '@/features/dashboards/hooks/useDoctorDashboardLiveUpdates';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';
import { hasQueryPrefix, invalidateQueriesMatching } from '@/shared/lib/queryInvalidation';

// Query keys
const dashboardKeyFactory = createKeyFactory('dashboards');

export const dashboardKeys = {
  all: dashboardKeyFactory.all,
  nurse: (filters) => keyWith('dashboards', 'nurse', { filters }),
  inpatient: () => keyWith('dashboards', 'inpatient'),
  receptionist: () => keyWith('dashboards', 'receptionist'),
  admin: () => keyWith('dashboards', 'admin'),
  adminV2Base: () => keyWith('dashboards', 'admin-v2'),
  adminV2Root: (filters) => keyWith('dashboards', 'admin-v2', 'root', { filters }),
  adminV2Capacity: (filters) => keyWith('dashboards', 'admin-v2', 'capacity', { filters }),
  adminV2Workforce: (filters) => keyWith('dashboards', 'admin-v2', 'workforce', { filters }),
  adminV2Compliance: (filters) => keyWith('dashboards', 'admin-v2', 'compliance', { filters }),
  myWork: (filters) => keyWith('dashboards', 'my-work', { filters }),
  clinic: (filters) => keyWith('dashboards', 'clinic', { filters }),
};

export function invalidateOperationalDoctorDashboardQueries(queryClient) {
  return invalidateQueriesMatching(queryClient, (query) => {
    const { queryKey } = query;

    return (
      hasQueryPrefix(queryKey, ['dashboards', 'my-work']) ||
      hasQueryPrefix(queryKey, ['dashboards', 'clinic'])
    );
  });
}

// Default polling interval (30 seconds)
const DEFAULT_REFETCH_INTERVAL = 30000;
const DEFAULT_ADMIN_WINDOW = 'today';

function normalizeAdminV2Filters(filters = {}) {
  const window = filters?.window || DEFAULT_ADMIN_WINDOW;
  return {
    ...filters,
    window,
  };
}

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
 * Get admin dashboard v2 summary payload.
 * Defaults to summary-only payload without expanded section detail.
 */
export function useAdminDashboardV2Summary(filters = {}, options = {}) {
  const { facilityCode } = useAuth();
  const normalizedFilters = normalizeAdminV2Filters(filters);
  return useQuery({
    queryKey: dashboardKeys.adminV2Root(normalizedFilters),
    queryFn: () => dashboardsApi.getAdminDashboardV2(normalizedFilters),
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode),
  });
}

/**
 * Get admin dashboard v2 capacity section details.
 */
export function useAdminDashboardV2Capacity(filters = {}, options = {}) {
  const { facilityCode } = useAuth();
  const normalizedFilters = normalizeAdminV2Filters(filters);
  return useQuery({
    queryKey: dashboardKeys.adminV2Capacity(normalizedFilters),
    queryFn: () => dashboardsApi.getAdminDashboardV2Capacity(normalizedFilters),
    refetchInterval: false,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode),
  });
}

/**
 * Get admin dashboard v2 workforce section details.
 */
export function useAdminDashboardV2Workforce(filters = {}, options = {}) {
  const { facilityCode } = useAuth();
  const normalizedFilters = normalizeAdminV2Filters(filters);
  return useQuery({
    queryKey: dashboardKeys.adminV2Workforce(normalizedFilters),
    queryFn: () => dashboardsApi.getAdminDashboardV2Workforce(normalizedFilters),
    refetchInterval: false,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode),
  });
}

/**
 * Get admin dashboard v2 compliance section details.
 */
export function useAdminDashboardV2Compliance(filters = {}, options = {}) {
  const { facilityCode } = useAuth();
  const normalizedFilters = normalizeAdminV2Filters(filters);
  return useQuery({
    queryKey: dashboardKeys.adminV2Compliance(normalizedFilters),
    queryFn: () => dashboardsApi.getAdminDashboardV2Compliance(normalizedFilters),
    refetchInterval: false,
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
  const { isConnected: isLiveConnected } = useDoctorDashboardLiveUpdates({
    enabled: (options.enabled ?? true) && Boolean(facilityCode),
    stream: 'my-work',
    practitionerId: filters?.practitioner_id || null,
    targetDate: filters?.date || null,
  });
  const hasCustomRefetchInterval = Object.prototype.hasOwnProperty.call(options, 'refetchInterval');
  const fallbackRefetchInterval = isLiveConnected ? false : DEFAULT_REFETCH_INTERVAL;
  return useQuery({
    queryKey: dashboardKeys.myWork(filters),
    queryFn: () => dashboardsApi.getMyWorkDashboard(filters),
    refetchInterval: hasCustomRefetchInterval ? options.refetchInterval : fallbackRefetchInterval,
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
  const { isConnected: isLiveConnected } = useDoctorDashboardLiveUpdates({
    enabled: (options.enabled ?? true) && Boolean(facilityCode),
    stream: 'clinic',
    practitionerId: filters?.practitioner_id || null,
    targetDate: filters?.date || null,
  });
  const hasCustomRefetchInterval = Object.prototype.hasOwnProperty.call(options, 'refetchInterval');
  const fallbackRefetchInterval = isLiveConnected ? false : DEFAULT_REFETCH_INTERVAL;
  return useQuery({
    queryKey: dashboardKeys.clinic(filters),
    queryFn: () => dashboardsApi.getClinicSchedule(filters),
    refetchInterval: hasCustomRefetchInterval ? options.refetchInterval : fallbackRefetchInterval,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode),
  });
}
