import { apiClient, handleApiError } from '../api-client';

/**
 * Patients API service
 */
export const patientsApi = {
  /**
   * Get all patients with optional filtering
   * Returns most recently registered patients first with pagination
   * @param {Object} params - Query parameters for filtering (page, page_size, etc.)
   * @returns {Promise<Object>} Paginated list of patients
   */
  getPatients: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/users/patients/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch patients'));
    }
  },

  /**
   * Get a single patient by ID
   * @param {string} id - Patient ID
   * @returns {Promise<Object>} Patient data
   */
  getPatient: async (id) => {
    try {
      return await apiClient.get(`/patients/${id}/get_patient/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch patient'));
    }
  },

  /**
   * Create a new patient
   * @param {Object} data - Patient data
   * @returns {Promise<Object>} Created patient data
   */
  createPatient: async (data) => {
    try {
      return await apiClient.post('/patients/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create patient'));
    }
  },

  /**
   * Update a patient
   * @param {string} id - Patient ID
   * @param {Object} data - Patient data to update
   * @returns {Promise<Object>} Updated patient data
   */
  updatePatient: async (id, data) => {
    try {
      return await apiClient.put(`/patients/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update patient'));
    }
  },

  /**
   * Delete a patient
   * @param {string} id - Patient ID
   * @returns {Promise<void>}
   */
  deletePatient: async (id) => {
    try {
      return await apiClient.delete(`/patients/${id}/delete_patient/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete patient'));
    }
  },

  /**
   * Get patient medical history
   * @param {string} id - Patient ID
   * @returns {Promise<Array>} Medical history data
   */
  getPatientHistory: async (id) => {
    try {
      return await apiClient.get(`/patients/${id}/history/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch patient history'));
    }
  },

  /**
   * Search patients
   * @param {string} query - Search query
   * @returns {Promise<Array>} List of matching patients
   */
  searchPatients: async (params) => {
    try {
      // Handle both string (legacy) and object params
      const queryParams = typeof params === 'string' ? { query: params } : params;
      const queryString = new URLSearchParams(queryParams).toString();
      return await apiClient.get(`/patients/search/?${queryString}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to search patients'));
    }
  },

  /**
   * Get recent patients
   * @param {Object} params - Query parameters
   * @param {number} params.limit - Maximum number of results (default: 10, max: 20)
   * @returns {Promise<Array>} List of recent patients
   */
  getRecentPatients: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/patients/recent/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch recent patients'));
    }
  },

  /**
   * Request break-glass access for a patient
   * @param {string} id - Patient ID
   * @param {Object} data - Break-glass payload (reason, scope)
   * @returns {Promise<Object>} Break-glass response
   */
  requestBreakGlass: async (id, data) => {
    return apiClient.post(`/patients/${id}/break-glass/`, data);
  },

  /**
   * Get context-specific patients based on user role
   * Returns ward patients for nurses, appointments for doctors, etc.
   * @param {Object} params - Query parameters (e.g., ward for nurses)
   * @returns {Promise<Object>} Context patients with metadata
   */
  getContextPatients: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/dashboards/my-context-patients/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch context patients'));
    }
  },

  /**
   * Register a new patient
   * @param {Object} data - Patient registration data
   * @returns {Promise<Object>} Registered patient data
   */
  registerPatient: async (data) => {
    try {
      return await apiClient.post('/patients/register/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to register patient'));
    }
  },

  /**
   * Update a patient with FHIR data
   * @param {string} id - Patient ID
   * @param {Object} data - Patient data with FHIR information
   * @returns {Promise<Object>} Updated patient data
   */
  updatePatientWithFHIR: async (id, data) => {
    try {
      return await apiClient.put(`/patients/${id}/update_patient/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update patient'));
    }
  },

  /**
   * Get patient registration validation rules
   * @returns {Promise<Array>} Validation rules
   */
  getValidationRules: async () => {
    try {
      return await apiClient.get('/patients/validation-rules/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch validation rules'));
    }
  },
};
