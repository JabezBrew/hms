import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { careAreasApi } from '@/features/care-areas/api';
import { useAuth } from '@/lib/auth';
import { createKeyFactory } from '@/shared/lib/queryKeys';

const baseKeys = createKeyFactory('care-areas');

export const careAreaKeys = {
  ...baseKeys,
  myWork: (scope) => [...baseKeys.all, 'my-work', scope],
};

function stableStringList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item)).sort()
    : [];
}

export function buildMyWorkScope(user, facilityCode) {
  const accessContext = user?.accessContext || user?.access_context || {};
  const profile = accessContext.active_profile_code
    || accessContext.deployment_profile
    || (typeof accessContext.active_profile === 'string' ? accessContext.active_profile : null)
    || (typeof accessContext.profile === 'string' ? accessContext.profile : null);

  return {
    facility: facilityCode || 'unknown',
    user: user?.id || 'anonymous',
    role: user?.role || 'unknown',
    staff: user?.staffId || null,
    practitioner: user?.practitionerId || null,
    profile: profile || null,
    sessionVersion: accessContext.session_version ?? user?.sessionVersion ?? null,
    permissionVersion: accessContext.permission_version ?? user?.permissionVersion ?? null,
    features: stableStringList(accessContext.features || user?.features),
    permissions: stableStringList(accessContext.permissions || user?.permissions || user?.adminAccess?.capabilities),
    patientVisibility: stableStringList(accessContext.patient_visibility || user?.patientVisibility),
  };
}

export function useCareAreaMyWork(options = {}) {
  const { user, facilityCode } = useAuth();
  const scope = buildMyWorkScope(user, facilityCode);

  return useQuery({
    queryKey: careAreaKeys.myWork(scope),
    queryFn: ({ signal }) => careAreasApi.getMyWork({ signal }),
    staleTime: 30 * 1000,
    ...options,
    enabled: (options.enabled ?? true) && Boolean(facilityCode) && Boolean(user?.id),
  });
}

export function useOutpatientIntake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => careAreasApi.startOutpatientIntake(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKeys.all });
    },
  });
}

export function useInpatientIntake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => careAreasApi.startInpatientIntake(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKeys.all });
    },
  });
}

export function useEmergencyIntake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => careAreasApi.startEmergencyIntake(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseKeys.all });
    },
  });
}
