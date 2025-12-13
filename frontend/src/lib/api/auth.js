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
  login: async (email, password) => {
    try {
      return await apiClient.post('/auth/login/', { email, password });
    } catch (error) {
      throw new Error(handleApiError(error, 'Login failed'));
    }
  },

  /**
   * Register a new user
   * @param {string} name - User's full name
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<Object>} User data with token
   */
  register: async (name, email, password) => {
    try {
      return await apiClient.post('/auth/register/', { name, email, password });
    } catch (error) {
      throw new Error(handleApiError(error, 'Registration failed'));
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
};
