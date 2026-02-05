import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { keyWith } from '@/shared/lib/queryKeys';

const doctorDashboardKeys = {
  dashboard: () => keyWith('doctor-dashboard'),
  clinicSchedule: (date, practitionerId) => keyWith('clinic-schedule', date, practitionerId),
};

/**
 * Hook for fetching doctor dashboard data
 * Returns today's clinic schedule with current/upcoming/completed appointments
 */
export function useDoctorDashboard() {
  const { facilityCode } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: doctorDashboardKeys.dashboard(),
    queryFn: () => apiClient.get('/dashboards/my-work/'),
    refetchInterval: 30000, // Refresh every 30 seconds
    enabled: Boolean(facilityCode),
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
  };
}

/**
 * Hook for fetching detailed clinic schedule
 */
export function useClinicSchedule(date, practitionerId) {
  const { facilityCode } = useAuth();
  return useQuery({
    queryKey: doctorDashboardKeys.clinicSchedule(date, practitionerId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (date) params.append('date', date);
      if (practitionerId) params.append('practitioner_id', practitionerId);
      return apiClient.get(`/dashboards/clinic/?${params.toString()}`);
    },
    enabled: Boolean(facilityCode) && (!!date || !!practitionerId),
  });
}
