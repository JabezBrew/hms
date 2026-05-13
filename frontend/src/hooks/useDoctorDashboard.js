import { useQuery } from '@tanstack/react-query';
import { dashboardsApi } from '@/features/dashboards/api';
import { useAuth } from '@/lib/auth';
import { useDoctorDashboardLiveUpdates } from '@/features/dashboards/hooks/useDoctorDashboardLiveUpdates';
import { keyWith } from '@/shared/lib/queryKeys';

const doctorDashboardKeys = {
  dashboard: () => keyWith('doctor-dashboard'),
  clinicSchedule: (date, practitionerId) => keyWith('clinic-schedule', date, practitionerId),
};

/**
 * Hook for fetching doctor dashboard data
 * Returns today's clinic schedule with current/upcoming/completed appointments
 */
export function useDoctorDashboard(options = {}) {
  const { facilityCode } = useAuth();
  const { refetchInterval = 30000, ...queryOptions } = options;
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: doctorDashboardKeys.dashboard(),
    queryFn: ({ signal }) => dashboardsApi.getMyWorkDashboard({ signal }),
    refetchInterval,
    enabled: Boolean(facilityCode) && (queryOptions.enabled ?? true),
    ...queryOptions,
  });

  return {
    data: data || {
      current_patient: null,
      upcoming: [],
      completed: [],
    },
    loading: isLoading,
    error,
    refetch,
    isFetching,
  };
}

/**
 * Hook for fetching detailed clinic schedule
 */
export function useClinicSchedule(date, practitionerId, options = {}) {
  const { facilityCode } = useAuth();
  const { isConnected: isLiveConnected } = useDoctorDashboardLiveUpdates({
    enabled: (options.enabled ?? true) && Boolean(facilityCode),
    stream: 'clinic',
    practitionerId: practitionerId || null,
    targetDate: date || null,
  });
  const hasCustomRefetchInterval = Object.prototype.hasOwnProperty.call(options, 'refetchInterval');
  const { refetchInterval = 30000, ...queryOptions } = options;
  return useQuery({
    queryKey: doctorDashboardKeys.clinicSchedule(date, practitionerId),
    queryFn: ({ signal }) => {
      return dashboardsApi.getClinicSchedule({
        ...(date ? { date } : {}),
        ...(practitionerId ? { practitioner_id: practitionerId } : {}),
        signal,
      });
    },
    refetchInterval: hasCustomRefetchInterval ? refetchInterval : (isLiveConnected ? false : refetchInterval),
    enabled: Boolean(facilityCode) && (!!date || !!practitionerId) && (queryOptions.enabled ?? true),
    ...queryOptions,
  });
}
