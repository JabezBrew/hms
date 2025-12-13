/**
 * Admissions API service
 */
import { apiClient, handleApiError } from '../api-client';

export const admissionsApi = {
  /**
   * Get all admissions with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of admissions
   */
  getAdmissions: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/wards/admissions/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getAll(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch admissions'));
    }
  },

  /**
   * Get a single admission by ID
   * @param {string} id - Admission ID
   * @returns {Promise<Object>} Admission data
   */
  getAdmission: async (id) => {
    try {
      return await apiClient.get(`/wards/admissions/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch admission'));
    }
  },

  /**
   * Create a new admission
   * @param {Object} data - Admission data
   * @returns {Promise<Object>} Created admission data
   */
  createAdmission: async (data) => {
    try {
      return await apiClient.post('/wards/admissions/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create admission'));
    }
  },

  /**
   * Update an admission
   * @param {string} id - Admission ID
   * @param {Object} data - Admission data to update
   * @returns {Promise<Object>} Updated admission data
   */
  updateAdmission: async (id, data) => {
    try {
      return await apiClient.put(`/wards/admissions/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update admission'));
    }
  },

  /**
   * Discharge a patient
   * @param {string} id - Admission ID
   * @param {Object} data - Discharge data
   * @returns {Promise<Object>} Discharged admission data
   */
  dischargePatient: async (id, data) => {
    try {
      return await apiClient.post(`/wards/admissions/${id}/discharge/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to discharge patient'));
    }
  },

  /**
   * Search patients for admission
   * @param {string} query - Search query
   * @returns {Promise<Array>} List of matching patients
   */
  searchPatients: async (query) => {
    try {
      if (!query || query.length < 2) {
        return [];
      }
      return await apiClient.get(`/patients/search/?query=${encodeURIComponent(query)}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to search patients'));
    }
  },

  /**
   * Search practitioners for admission
   * @param {string} query - Search query
   * @param {boolean} doctorsOnly - Whether to filter for doctors only
   * @returns {Promise<Array>} List of matching practitioners
   */
  searchPractitioners: async (query, doctorsOnly = false) => {
    try {
      if (!query || query.length < 2) {
        return [];
      }

      const params = new URLSearchParams({
        q: query
      });

      if (doctorsOnly) {
        params.append('doctors_only', 'true');
      }

      const response = await apiClient.get(`/users/practitioners/search/?${params.toString()}`);

      // Handle the response structure which includes a "practitioners" array
      if (response && response.practitioners) {
        return response.practitioners;
      }

      // Fallback to the old response structure for backward compatibility
      return Array.isArray(response) ? response : [];
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to search practitioners'));
    }
  }
};
