import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, handleApiError } from '@/lib/api-client';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { keyWith } from '@/shared/lib/queryKeys';
import { authApi } from '@/shared/api/auth';

/**
 * Settings API functions
 * Uses the correct backend endpoints:
 * - Profile: /api/users/users/me/ (GET) and /api/users/users/{id}/ (PATCH)
 * - Password: /api/users/users/change_password/ (POST)
 * - Sessions: /api/users/sessions/ with revoke and revoke_all actions
 */
const settingsApi = {
  getProfile: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return await authApi.getProfile(options);
      }
      return await apiClient.get('/users/users/me/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch profile'));
    }
  },

  updateProfile: async (data) => {
    try {
      if (isRustV2ApiMode()) {
        return await authApi.updateProfile(data);
      }
      // First get the current user to get their ID
      const currentUser = await apiClient.get('/users/users/me/');
      // Then update using the user's ID
      return await apiClient.patch(`/users/users/${currentUser.id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update profile'));
    }
  },

  changePassword: async ({ oldPassword, newPassword }) => {
    try {
      if (isRustV2ApiMode()) {
        return await authApi.changePassword({ oldPassword, newPassword });
      }
      return await apiClient.post('/users/users/change_password/', {
        old_password: oldPassword,
        new_password: newPassword,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to change password'));
    }
  },

  getSessions: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return await authApi.listSessions(options);
      }
      return await apiClient.get('/users/sessions/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch sessions'));
    }
  },

  revokeSession: async (sessionId) => {
    try {
      if (isRustV2ApiMode()) {
        return await authApi.revokeSession(sessionId);
      }
      return await apiClient.post(`/users/sessions/${sessionId}/revoke/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to revoke session'));
    }
  },

  revokeAllSessions: async (excludeCurrent = true) => {
    try {
      if (isRustV2ApiMode()) {
        return await authApi.revokeAllSessions(excludeCurrent);
      }
      return await apiClient.post('/users/sessions/revoke_all/', {
        exclude_current: excludeCurrent,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to revoke sessions'));
    }
  },

  getMfaStatus: async () => {
    try {
      if (isRustV2ApiMode()) {
        return {
          totp_enrolled: false,
          webauthn_enrolled: false,
          recovery_codes_remaining: 0,
          rust_v2_unsupported: true,
        };
      }
      return await authApi.mfaStatus();
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch MFA status'));
    }
  },

  mfaTotpStart: async () => {
    try {
      return await authApi.mfaTotpStart();
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to start TOTP setup'));
    }
  },

  mfaTotpConfirm: async (code) => {
    try {
      return await authApi.mfaTotpConfirm(code);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to confirm TOTP setup'));
    }
  },
};

const settingsKeys = {
  profile: () => keyWith('settings', 'profile'),
  sessions: () => keyWith('settings', 'sessions'),
  mfaStatus: () => keyWith('settings', 'mfaStatus'),
};

/**
 * Hook to fetch user profile
 */
export function useProfile() {
  return useQuery({
    queryKey: settingsKeys.profile(),
    queryFn: ({ signal }) => settingsApi.getProfile({ signal }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to update user profile
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: settingsApi.updateProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.profile() });
    },
  });
}

/**
 * Hook to change password
 */
export function useChangePassword() {
  // No cache invalidation: password change does not alter cached profile/session query payloads.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: settingsApi.changePassword,
  });
}

/**
 * Hook to fetch user sessions
 */
export function useUserSessions() {
  return useQuery({
    queryKey: settingsKeys.sessions(),
    queryFn: ({ signal }) => settingsApi.getSessions({ signal }),
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to revoke a specific session
 */
export function useRevokeSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: settingsApi.revokeSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.sessions() });
    },
  });
}

/**
 * Hook to revoke all sessions except current
 */
export function useRevokeAllSessions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: settingsApi.revokeAllSessions,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.sessions() });
    },
  });
}

/**
 * Hook to fetch MFA status
 */
export function useMfaStatus() {
  return useQuery({
    queryKey: settingsKeys.mfaStatus(),
    queryFn: settingsApi.getMfaStatus,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to start TOTP enrollment.
 */
export function useMfaTotpStart() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: settingsApi.mfaTotpStart,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.mfaStatus() });
    },
  });
}

/**
 * Hook to confirm TOTP enrollment.
 */
export function useMfaTotpConfirm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: settingsApi.mfaTotpConfirm,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.mfaStatus() });
    },
  });
}
