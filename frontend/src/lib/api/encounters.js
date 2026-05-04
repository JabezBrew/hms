/**
 * Encounters API service
 */
import { apiClient, handleApiError } from '../api-client';

export const encountersApi = {
  /**
   * Get encounters with pagination and filtering
   * @param {Object} params - Query parameters for filtering and pagination
   * @param {number} params.page - Page number (default: 1)
   * @param {number} params.page_size - Items per page (default: 100, max: 1000)
   * @param {string} params.status - Filter by status
   * @param {string} params.encounter_type - Filter by type
   * @param {string} params.patient_id - Filter by patient ID
   * @param {string} params.practitioner_id - Filter by practitioner ID
   * @param {string} params.date - Filter by date (YYYY-MM-DD)
   * @returns {Promise<Object>} Paginated response with results, count, next, previous
   */
  getEncounters: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/encounters/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
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
      return await apiClient.get(`/encounters/${id}/`);
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
      return await apiClient.post('/encounters/', data);
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
      return await apiClient.patch(`/encounters/${id}/`, data);
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
      return await apiClient.delete(`/encounters/${id}/`);
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
      return await apiClient.post(`/encounters/${id}/discharge/`, data);
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
      return await apiClient.post(`/encounters/${id}/cancel/`);
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
  getEncountersForPatient: async (patientId, options = {}) => {
    try {
      return await apiClient.get('/encounters/for_patient/', {
        ...options,
        params: { patient_id: patientId },
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch patient encounters'));
    }
  }
};
