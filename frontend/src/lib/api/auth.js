import { apiClient, handleApiError } from '../api-client';
import { getClientDeviceLabel } from '../device-label';
import { getDefaultFacilityCode } from '../runtime-config';
import { isRustV2ApiMode } from './v2/runtime';
import { handleV2ApiError } from './v2/errors';
import { performV2TokenRefresh, v2Api } from './v2/client';

function splitDisplayName(displayName, email) {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return [email || '', ''];
  }
  if (parts.length === 1) {
    return [parts[0], ''];
  }
  return [parts[0], parts.slice(1).join(' ')];
}

function inferUserTypeFromV2Permissions(permissions = []) {
  if (permissions.some((permission) => permission.startsWith('admin.') || permission.startsWith('system.'))) {
    return 'admin';
  }
  if (permissions.some((permission) => permission.startsWith('nursing.') || permission.includes('.nursing.'))) {
    return 'nurse';
  }
  if (permissions.some((permission) => permission.startsWith('laboratory.') || permission.startsWith('lab.'))) {
    return 'lab_technician';
  }
  if (permissions.some((permission) => permission.startsWith('pharmacy.'))) {
    return 'pharmacist';
  }
  if (permissions.some((permission) => permission.startsWith('billing.'))) {
    return 'billing_staff';
  }
  if (permissions.some((permission) => permission.startsWith('patient.') || permission.startsWith('encounter.'))) {
    return 'doctor';
  }
  return 'staff';
}

function adaptV2AuthTokenResponse(response) {
  const token = response?.data;
  const user = token?.user;
  if (!token?.access_token || !user) {
    return response;
  }

  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  const [firstName, lastName] = splitDisplayName(user.display_name, user.email);

  return {
    access: token.access_token,
    password_change_required: Boolean(user.password_change_required),
    access_context: {
      permissions,
      features: Array.isArray(user.features) ? user.features : [],
      patient_visibility: Array.isArray(user.patient_visibility) ? user.patient_visibility : [],
      active_profile: user.active_profile,
      facility_id: user.facility_id,
      session_version: user.session_version,
      permission_version: user.permission_version,
    },
    user: {
      id: user.id,
      email: user.email,
      user_type: inferUserTypeFromV2Permissions(permissions),
      first_name: firstName,
      last_name: lastName,
      staff_id: null,
      practitioner_id: null,
      facility_code: user.facility_code,
      admin_access: {
        capabilities: permissions,
      },
    },
  };
}

function adaptV2AuthUser(user) {
  if (!user) return user;
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  const [firstName, lastName] = splitDisplayName(user.display_name, user.email);
  return {
    id: user.id,
    email: user.email,
    first_name: firstName,
    last_name: lastName,
    display_name: user.display_name,
    phone_number: '',
    user_type: inferUserTypeFromV2Permissions(permissions),
    facility_id: user.facility_id,
    facility_code: user.facility_code,
    active_profile: user.active_profile,
    permissions,
    features: Array.isArray(user.features) ? user.features : [],
    patient_visibility: Array.isArray(user.patient_visibility) ? user.patient_visibility : [],
    password_change_required: Boolean(user.password_change_required),
    admin_access: {
      capabilities: permissions,
    },
  };
}

function normalizeV2ProfileUpdate(data = {}) {
  const displayName = data.display_name
    ?? data.name
    ?? ([data.first_name, data.last_name].filter(Boolean).join(' ').trim() || undefined);

  return {
    ...(displayName ? { display_name: displayName } : {}),
  };
}

function unsupportedInRustV2(message) {
  return Promise.reject(new Error(message));
}

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
      if (isRustV2ApiMode()) {
        const v2FacilityCode = facilityCode || getDefaultFacilityCode();
        const response = await v2Api.postAuthLogin({
          email,
          password,
          facility_code: v2FacilityCode,
        });
        return adaptV2AuthTokenResponse(response);
      }

      const payload = { email, password };
      if (facilityCode) {
        payload.facility_code = facilityCode;
      }
      const headers = {};
      if (facilityCode) {
        headers['X-Facility-Code'] = facilityCode;
      }
      const deviceLabel = getClientDeviceLabel();
      if (deviceLabel) {
        headers['X-Device-Label'] = deviceLabel;
      }
      return await apiClient.post('/auth/login/', payload, { headers });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Login failed'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postAuthPasswordResetRequest({
          email,
          facility_code: getDefaultFacilityCode(),
        });
        return response?.data || response;
      }
      return await apiClient.post('/auth/password-reset/', { email });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Password reset request failed'));
      }
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
      if (isRustV2ApiMode()) {
        if (!token) {
          return { valid: false, detail: 'No reset token provided.' };
        }
        return { valid: true, email: '', rust_v2_unverified: true };
      }
      return await apiClient.post('/auth/password-reset/validate-token/', { token });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Token validation failed'));
      }
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
      if (isRustV2ApiMode()) {
        if (password !== passwordConfirm) {
          throw new Error('Passwords do not match');
        }
        const response = await v2Api.postAuthPasswordResetComplete({
          token,
          new_password: password,
        });
        return response?.data || response;
      }
      return await apiClient.post('/auth/password-reset/confirm/', {
        token,
        password,
        password_confirm: passwordConfirm
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Password reset failed'));
      }
      throw new Error(handleApiError(error, 'Password reset failed'));
    }
  },

  /**
   * Get current user profile
   * @returns {Promise<Object>} User profile data
   */
  getProfile: async () => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getAuthMe();
        return adaptV2AuthUser(response?.data);
      }
      return await apiClient.get('/auth/profile/');
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to get user profile'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchAuthMe(normalizeV2ProfileUpdate(data));
        return adaptV2AuthUser(response?.data);
      }
      return await apiClient.patch('/auth/profile/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to update profile'));
      }
      throw new Error(handleApiError(error, 'Failed to update profile'));
    }
  },

  changePassword: async ({ oldPassword, newPassword }) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postAuthPassword({
          current_password: oldPassword,
          new_password: newPassword,
        });
        return response?.data || response;
      }
      return await apiClient.post('/users/users/change_password/', {
        old_password: oldPassword,
        new_password: newPassword,
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to change password'));
      }
      throw new Error(handleApiError(error, 'Failed to change password'));
    }
  },

  listSessions: async () => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getAuthSessions();
        return response?.data || response;
      }
      return await apiClient.get('/users/sessions/');
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch sessions'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch sessions'));
    }
  },

  revokeSession: async (sessionId) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postAuthSessionRevoke({ session_id: sessionId });
        return response?.data || response;
      }
      return await apiClient.post(`/users/sessions/${sessionId}/revoke/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to revoke session'));
      }
      throw new Error(handleApiError(error, 'Failed to revoke session'));
    }
  },

  revokeAllSessions: async (excludeCurrent = true) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postAuthSessionsRevokeAll({
          exclude_current: excludeCurrent,
        });
        return response?.data || response;
      }
      return await apiClient.post('/users/sessions/revoke_all/', {
        exclude_current: excludeCurrent,
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to revoke sessions'));
      }
      throw new Error(handleApiError(error, 'Failed to revoke sessions'));
    }
  },

  /**
   * Logout user
   * @returns {Promise<Object>} Success message
   */
  logout: async () => {
    try {
      if (isRustV2ApiMode()) {
        return await v2Api.postAuthLogout();
      }
      return await apiClient.post('/auth/logout/');
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Logout failed'));
      }
      throw new Error(handleApiError(error, 'Logout failed'));
    }
  },

  /**
   * Refresh access token using the refresh token in HttpOnly cookie
   * @returns {Promise<Object>} New access token
   */
  refreshToken: async () => {
    try {
      if (isRustV2ApiMode()) {
        const response = await performV2TokenRefresh();
        return adaptV2AuthTokenResponse({ data: response });
      }
      return await apiClient.post('/auth/token/refresh/');
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Token refresh failed'));
      }
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
      if (isRustV2ApiMode()) {
        return unsupportedInRustV2('Rust V2 does not expose user-id password reset administration yet');
      }
      return await apiClient.post('/auth/admin/force-reset/', { user_id: userId });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Password reset failed'));
      }
      throw new Error(handleApiError(error, 'Password reset failed'));
    }
  },

  mfaStatus: async (mfaSession = null) => {
    try {
      if (isRustV2ApiMode()) {
        return unsupportedInRustV2('Rust V2 does not expose MFA management yet');
      }
      const headers = mfaSession ? { 'X-MFA-Session': mfaSession } : undefined;
      return await apiClient.get('/auth/mfa/status/', { headers });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to load MFA status'));
      }
      throw new Error(handleApiError(error, 'Failed to load MFA status'));
    }
  },

  mfaTotpStart: async (mfaSession) => {
    try {
      if (isRustV2ApiMode()) {
        return unsupportedInRustV2('Rust V2 does not expose MFA management yet');
      }
      return await apiClient.post('/auth/mfa/totp/start/', { mfa_session: mfaSession });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to start TOTP setup'));
      }
      throw new Error(handleApiError(error, 'Failed to start TOTP setup'));
    }
  },

  mfaTotpConfirm: async (code, mfaSession) => {
    try {
      if (isRustV2ApiMode()) {
        return unsupportedInRustV2('Rust V2 does not expose MFA management yet');
      }
      return await apiClient.post('/auth/mfa/totp/confirm/', { code, mfa_session: mfaSession });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to confirm TOTP'));
      }
      throw new Error(handleApiError(error, 'Failed to confirm TOTP'));
    }
  },

  mfaTotpVerify: async (code, mfaSession) => {
    try {
      if (isRustV2ApiMode()) {
        return unsupportedInRustV2('Rust V2 does not expose MFA management yet');
      }
      return await apiClient.post('/auth/mfa/totp/verify/', { code, mfa_session: mfaSession });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to verify TOTP'));
      }
      throw new Error(handleApiError(error, 'Failed to verify TOTP'));
    }
  },

  mfaRecoveryGenerate: async () => {
    try {
      if (isRustV2ApiMode()) {
        return unsupportedInRustV2('Rust V2 does not expose MFA management yet');
      }
      return await apiClient.post('/auth/mfa/recovery/', {});
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to generate recovery codes'));
      }
      throw new Error(handleApiError(error, 'Failed to generate recovery codes'));
    }
  },

  mfaRecoveryVerify: async (code, mfaSession) => {
    try {
      if (isRustV2ApiMode()) {
        return unsupportedInRustV2('Rust V2 does not expose MFA management yet');
      }
      return await apiClient.post('/auth/mfa/recovery/verify/', { code, mfa_session: mfaSession });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to verify recovery code'));
      }
      throw new Error(handleApiError(error, 'Failed to verify recovery code'));
    }
  },

  mfaWebAuthnRegistrationOptions: async (mfaSession) => {
    try {
      if (isRustV2ApiMode()) {
        return unsupportedInRustV2('Rust V2 does not expose MFA management yet');
      }
      return await apiClient.post('/auth/mfa/webauthn/registration/options/', { mfa_session: mfaSession });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to start WebAuthn registration'));
      }
      throw new Error(handleApiError(error, 'Failed to start WebAuthn registration'));
    }
  },

  mfaWebAuthnRegistrationVerify: async (credential, mfaSession) => {
    try {
      if (isRustV2ApiMode()) {
        return unsupportedInRustV2('Rust V2 does not expose MFA management yet');
      }
      return await apiClient.post('/auth/mfa/webauthn/registration/verify/', {
        credential,
        mfa_session: mfaSession,
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to verify WebAuthn registration'));
      }
      throw new Error(handleApiError(error, 'Failed to verify WebAuthn registration'));
    }
  },

  mfaWebAuthnAuthOptions: async (mfaSession) => {
    try {
      if (isRustV2ApiMode()) {
        return unsupportedInRustV2('Rust V2 does not expose MFA management yet');
      }
      return await apiClient.post('/auth/mfa/webauthn/authentication/options/', { mfa_session: mfaSession });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to start WebAuthn authentication'));
      }
      throw new Error(handleApiError(error, 'Failed to start WebAuthn authentication'));
    }
  },

  mfaWebAuthnAuthVerify: async (credential, mfaSession) => {
    try {
      if (isRustV2ApiMode()) {
        return unsupportedInRustV2('Rust V2 does not expose MFA management yet');
      }
      return await apiClient.post('/auth/mfa/webauthn/authentication/verify/', {
        credential,
        mfa_session: mfaSession,
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to verify WebAuthn authentication'));
      }
      throw new Error(handleApiError(error, 'Failed to verify WebAuthn authentication'));
    }
  },
};
