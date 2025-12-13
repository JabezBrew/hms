/**
 * Encounters API service
 */
import { apiClient, handleApiError } from '../api-client';

export const encountersApi = {
  /**
   * Get all encounters with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of encounters
   */
  getEncounters: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/wards/encounters/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getAll(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch encounters'));
    }
  },

  /**
   * Get a single encounter by ID
   * @param {string} id - Encounter ID
   * @returns {Promise<Object>} Encounter data
   */
  getEncounter: async (id) => {
    try {
      return await apiClient.get(`/wards/encounters/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch encounter'));
    }
  },

  /**
   * Create a new encounter
   * @param {Object} data - Encounter data
   * @returns {Promise<Object>} Created encounter data
   */
  createEncounter: async (data) => {
    try {
      return await apiClient.post('/wards/encounters/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create encounter'));
    }
  },

  /**
   * Update an encounter
   * @param {string} id - Encounter ID
   * @param {Object} data - Encounter data to update
   * @returns {Promise<Object>} Updated encounter data
   */
  updateEncounter: async (id, data) => {
    try {
      return await apiClient.put(`/wards/encounters/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update encounter'));
    }
  },

  /**
   * Delete an encounter
   * @param {string} id - Encounter ID
   * @returns {Promise<Object>} Empty object or operation outcome
   */
  deleteEncounter: async (id) => {
    try {
      return await apiClient.delete(`/wards/encounters/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete encounter'));
    }
  },

  /**
   * Discharge a patient (for inpatient encounters)
   * @param {string} id - Encounter ID
   * @param {Object} data - Discharge data
   * @returns {Promise<Object>} Updated encounter data
   */
  dischargePatient: async (id, data) => {
    try {
      return await apiClient.post(`/wards/encounters/${id}/discharge/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to discharge patient'));
    }
  },

  /**
   * Cancel an encounter
   * @param {string} id - Encounter ID
   * @returns {Promise<Object>} Updated encounter data
   */
  cancelEncounter: async (id) => {
    try {
      return await apiClient.post(`/wards/encounters/${id}/cancel/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to cancel encounter'));
    }
  },

  /**
   * Search patients for encounter
   * @param {string} query - Search query
   * @returns {Promise<Array>} List of matching patients
   */
  searchPatients: async (query) => {
    try {
      if (!query || query.length < 2) {
        return [];
      }
      const response = await apiClient.get(`/patients/search/?query=${encodeURIComponent(query)}`);

      // Handle response structure { query, total, patients: [...] }
      if (response && response.patients) {
        return response.patients;
      }

      return Array.isArray(response) ? response : [];
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to search patients'));
    }
  },

  /**
   * Search practitioners for encounter
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

      // Handle the new response structure which includes a "practitioners" array
      if (response && response.practitioners) {
        return response.practitioners;
      }

      // Fallback to the old response structure for backward compatibility
      return Array.isArray(response) ? response : [];
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to search practitioners'));
    }
  },

  /**
   * Get all encounters for a specific patient
   * @param {string} patientId - Patient ID
   * @returns {Promise<Array>} List of encounters for the patient
   */
  getEncountersForPatient: async (patientId) => {
    try {
      return await apiClient.getAll(`/wards/encounters/for_patient/?patient_id=${patientId}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch patient encounters'));
    }
  }
};