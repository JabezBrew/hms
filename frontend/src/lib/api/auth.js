import { apiClient, handleApiError } from '../api-client';

/**
 * Authentication API service
 */
export const authApi = {
  /**
   * Login with email and password
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<Object>} User data with token
   */
  login: async (email, password, facilityCode) => {
    try {
      const payload = { email, password };
      if (facilityCode) {
        payload.facility_code = facilityCode;
      }
      const headers = facilityCode ? { 'X-Facility-Code': facilityCode } : undefined;
      return await apiClient.post('/auth/login/', payload, { headers });
    } catch (error) {
      throw new Error(handleApiError(error, 'Login failed'));
    }
  },

  /**
   * Request password reset
   * @param {string} email - User email
   * @returns {Promise<Object>} Success message
   */
  requestPasswordReset: async (email) => {
    try {
      return await apiClient.post('/auth/password-reset/', { email });
    } catch (error) {
      throw new Error(handleApiError(error, 'Password reset request failed'));
    }
  },

  /**
   * Validate reset token
   * @param {string} token - Reset token from email
   * @returns {Promise<Object>} Token validation result
   */
  validateResetToken: async (token) => {
    try {
      return await apiClient.post('/auth/password-reset/validate-token/', { token });
    } catch (error) {
      throw new Error(handleApiError(error, 'Token validation failed'));
    }
  },

  /**
   * Reset password with token
   * @param {string} token - Reset token from email
   * @param {string} password - New password
   * @param {string} passwordConfirm - Password confirmation
   * @returns {Promise<Object>} Success message
   */
  resetPassword: async (token, password, passwordConfirm) => {
    try {
      return await apiClient.post('/auth/password-reset/confirm/', {
        token,
        password,
        password_confirm: passwordConfirm
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Password reset failed'));
    }
  },

  /**
   * Get current user profile
   * @returns {Promise<Object>} User profile data
   */
  getProfile: async () => {
    try {
      return await apiClient.get('/auth/profile/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to get user profile'));
    }
  },

  /**
   * Update user profile
   * @param {Object} data - Profile data to update
   * @returns {Promise<Object>} Updated user profile
   */
  updateProfile: async (data) => {
    try {
      return await apiClient.patch('/auth/profile/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update profile'));
    }
  },

  /**
   * Logout user
   * @returns {Promise<Object>} Success message
   */
  logout: async () => {
    try {
      return await apiClient.post('/auth/logout/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Logout failed'));
    }
  },

  /**
   * Refresh access token using the refresh token in HttpOnly cookie
   * @returns {Promise<Object>} New access token
   */
  refreshToken: async () => {
    try {
      return await apiClient.post('/auth/token/refresh/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Token refresh failed'));
    }
  },

  /**
   * Admin force reset password for a user
   * @param {string} userId - User ID to reset password for
   * @returns {Promise<Object>} Success message
   */
  adminForceResetPassword: async (userId) => {
    try {
      return await apiClient.post('/auth/admin/force-reset/', { user_id: userId });
    } catch (error) {
      throw new Error(handleApiError(error, 'Password reset failed'));
    }
  },

  mfaStatus: async () => {
    try {
      return await apiClient.get('/auth/mfa/status/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to load MFA status'));
    }
  },

  mfaTotpStart: async (mfaSession) => {
    try {
      return await apiClient.post('/auth/mfa/totp/start/', { mfa_session: mfaSession });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to start TOTP setup'));
    }
  },

  mfaTotpConfirm: async (code, mfaSession) => {
    try {
      return await apiClient.post('/auth/mfa/totp/confirm/', { code, mfa_session: mfaSession });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to confirm TOTP'));
    }
  },

  mfaTotpVerify: async (code, mfaSession) => {
    try {
      return await apiClient.post('/auth/mfa/totp/verify/', { code, mfa_session: mfaSession });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to verify TOTP'));
    }
  },

  mfaRecoveryGenerate: async () => {
    try {
      return await apiClient.post('/auth/mfa/recovery/', {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to generate recovery codes'));
    }
  },

  mfaRecoveryVerify: async (code, mfaSession) => {
    try {
      return await apiClient.post('/auth/mfa/recovery/verify/', { code, mfa_session: mfaSession });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to verify recovery code'));
    }
  },

  mfaWebAuthnRegistrationOptions: async (mfaSession) => {
    try {
      return await apiClient.post('/auth/mfa/webauthn/registration/options/', { mfa_session: mfaSession });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to start WebAuthn registration'));
    }
  },

  mfaWebAuthnRegistrationVerify: async (credential, mfaSession) => {
    try {
      return await apiClient.post('/auth/mfa/webauthn/registration/verify/', {
        credential,
        mfa_session: mfaSession,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to verify WebAuthn registration'));
    }
  },

  mfaWebAuthnAuthOptions: async (mfaSession) => {
    try {
      return await apiClient.post('/auth/mfa/webauthn/authentication/options/', { mfa_session: mfaSession });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to start WebAuthn authentication'));
    }
  },

  mfaWebAuthnAuthVerify: async (credential, mfaSession) => {
    try {
      return await apiClient.post('/auth/mfa/webauthn/authentication/verify/', {
        credential,
        mfa_session: mfaSession,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to verify WebAuthn authentication'));
    }
  },
};
