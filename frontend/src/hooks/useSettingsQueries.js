import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, handleApiError } from '@/lib/api-client';

/**
 * Settings API functions
 * Uses the correct backend endpoints:
 * - Profile: /api/users/users/me/ (GET) and /api/users/users/{id}/ (PATCH)
 * - Password: /api/users/users/change_password/ (POST)
 * - Sessions: /api/users/sessions/ with revoke and revoke_all actions
 */
const settingsApi = {
  getProfile: async () => {
    try {
      return await apiClient.get('/users/users/me/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch profile'));
    }
  },

  updateProfile: async (data) => {
    try {
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
      return await apiClient.post('/users/users/change_password/', {
        old_password: oldPassword,
        new_password: newPassword,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to change password'));
    }
  },

  getSessions: async () => {
    try {
      return await apiClient.get('/users/sessions/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch sessions'));
    }
  },

  revokeSession: async (sessionId) => {
    try {
      return await apiClient.post(`/users/sessions/${sessionId}/revoke/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to revoke session'));
    }
  },

  revokeAllSessions: async (excludeCurrent = true) => {
    try {
      return await apiClient.post('/users/sessions/revoke_all/', {
        exclude_current: excludeCurrent,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to revoke sessions'));
    }
  },

  getMfaStatus: async () => {
    try {
      return await apiClient.get('/auth/mfa/status/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch MFA status'));
    }
  },
};

/**
 * Query key factory for settings
 */
export const settingsKeys = {
  all: ['settings'],
  profile: () => [...settingsKeys.all, 'profile'],
  sessions: () => [...settingsKeys.all, 'sessions'],
  mfaStatus: () => [...settingsKeys.all, 'mfaStatus'],
};

/**
 * Hook to fetch user profile
 */
export function useProfile() {
  return useQuery({
    queryKey: settingsKeys.profile(),
    queryFn: settingsApi.getProfile,
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
    queryFn: settingsApi.getSessions,
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
