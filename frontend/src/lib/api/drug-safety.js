/**
 * Drug Safety API service
 */
import { apiClient, handleApiError } from '../api-client';

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function normalizeListResponse(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

export const drugSafetyApi = {
  /**
   * Perform comprehensive drug safety check
   * @param {Object} data - Safety check request { patient_id, medication_name, encounter_id? }
   * @returns {Promise<Object>} Safety check response with alerts
   */
  checkPrescriptionSafety: async (data) => {
    try {
      return await apiClient.post('/drug-safety/safety/check/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to perform safety check'));
    }
  },

  /**
   * Search for drugs using RxNorm
   * @param {string} query - Search query
   * @param {number} maxResults - Maximum number of results
   * @returns {Promise<Object>} Search results { results: [...] }
   */
  searchDrugs: async (query, maxResults = 10) => {
    try {
      const params = new URLSearchParams({ q: query, max_results: maxResults });
      return await apiClient.get(`/drug-safety/safety/search_drugs/?${params.toString()}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to search drugs'));
    }
  },

  /**
   * Get available drug forms (strengths and dose forms) for a drug
   * @param {string} rxcui - RxNorm Concept Unique Identifier
   * @returns {Promise<Object>} Drug forms { forms: [...] }
   */
  getDrugForms: async (rxcui) => {
    try {
      const params = new URLSearchParams({ rxcui });
      return await apiClient.get(`/drug-safety/safety/drug_forms/?${params.toString()}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch drug forms'));
    }
  },

  /**
   * Get patient allergies
   * @param {string} patientId - Patient ID
   * @returns {Promise<Object>} Patient allergies { count, allergies: [...] }
   */
  getPatientAllergies: async (patientId) => {
    try {
      const params = new URLSearchParams({ patient_id: patientId });
      return await apiClient.get(`/drug-safety/safety/patient_allergies/?${params.toString()}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch patient allergies'));
    }
  },

  /**
   * Get all allergies with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of allergies
   */
  getAllergies: async (params = {}, options = {}) => {
    try {
      const response = await apiClient.getWithPagination('/drug-safety/allergies/', {
        ...options,
        params,
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch allergies'));
    }
  },

  /**
   * Get a single allergy by ID
   * @param {string} id - Allergy ID
   * @returns {Promise<Object>} Allergy data
   */
  getAllergy: async (id) => {
    try {
      return await apiClient.get(`/drug-safety/allergies/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch allergy'));
    }
  },

  /**
   * Create a new allergy
   * @param {Object} data - Allergy data
   * @returns {Promise<Object>} Created allergy data
   */
  createAllergy: async (data) => {
    try {
      return await apiClient.post('/drug-safety/allergies/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create allergy'));
    }
  },

  /**
   * Update an allergy
   * @param {string} id - Allergy ID
   * @param {Object} data - Allergy data to update
   * @returns {Promise<Object>} Updated allergy data
   */
  updateAllergy: async (id, data) => {
    try {
      return await apiClient.patch(`/drug-safety/allergies/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update allergy'));
    }
  },

  /**
   * Delete an allergy
   * @param {string} id - Allergy ID
   * @returns {Promise<Object>} Empty object or operation outcome
   */
  deleteAllergy: async (id) => {
    try {
      return await apiClient.delete(`/drug-safety/allergies/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete allergy'));
    }
  },

  /**
   * Verify an allergy (doctors only)
   * @param {string} id - Allergy ID
   * @returns {Promise<Object>} Verified allergy data
   */
  verifyAllergy: async (id) => {
    try {
      return await apiClient.post(`/drug-safety/allergies/${id}/verify/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to verify allergy'));
    }
  },

  /**
   * Deactivate an allergy
   * @param {string} id - Allergy ID
   * @returns {Promise<Object>} Deactivated allergy data
   */
  deactivateAllergy: async (id) => {
    try {
      return await apiClient.post(`/drug-safety/allergies/${id}/deactivate/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to deactivate allergy'));
    }
  },

  /**
   * Get all safety alerts with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of safety alerts
   */
  getAlerts: async (params = {}, options = {}) => {
    try {
      const response = await apiClient.getWithPagination('/drug-safety/alerts/', {
        ...options,
        params,
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch safety alerts'));
    }
  },

  /**
   * Get a single safety alert by ID
   * @param {string} id - Alert ID
   * @returns {Promise<Object>} Alert data
   */
  getAlert: async (id) => {
    try {
      return await apiClient.get(`/drug-safety/alerts/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch safety alert'));
    }
  },

  /**
   * Override a safety alert (doctors only)
   * @param {string} id - Alert ID
   * @param {string} overrideReason - Reason for override
   * @returns {Promise<Object>} Overridden alert data
   */
  overrideAlert: async (id, overrideReason) => {
    try {
      return await apiClient.post(`/drug-safety/alerts/${id}/override/`, {
        override_reason: overrideReason,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to override alert'));
    }
  },
};
