import { apiClient, handleApiError } from '../api-client';

/**
 * My Patients API service
 * Manages user's personal patient list for quick access
 */
export const myPatientsApi = {
  /**
   * Get user's personal patient list
   * @returns {Promise<Array>} List of patients in user's list
   */
  getMyPatients: async () => {
    try {
      return await apiClient.get('/users/my-patients/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch my patients'));
    }
  },

  /**
   * Add a patient to user's list
   * @param {string} patientId - Patient ID to add
   * @param {Object} options - Optional settings (notes, is_pinned)
   * @returns {Promise<Object>} Created list entry
   */
  addPatient: async (patientId, options = {}) => {
    try {
      return await apiClient.post('/users/my-patients/add_patient/', {
        patient_id: patientId,
        notes: options.notes || '',
        is_pinned: options.is_pinned || false,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to add patient to list'));
    }
  },

  /**
   * Remove a patient from user's list
   * @param {string} patientId - Patient ID to remove
   * @returns {Promise<Object>} Success message
   */
  removePatient: async (patientId) => {
    try {
      return await apiClient.delete(`/users/my-patients/remove_patient/?patient_id=${patientId}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to remove patient from list'));
    }
  },

  /**
   * Remove a list entry by its ID
   * @param {string} entryId - List entry ID
   * @returns {Promise<void>}
   */
  removeEntry: async (entryId) => {
    try {
      return await apiClient.delete(`/users/my-patients/${entryId}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to remove patient from list'));
    }
  },

  /**
   * Toggle pin status for a patient in the list
   * @param {string} entryId - List entry ID
   * @returns {Promise<Object>} Updated entry
   */
  togglePin: async (entryId) => {
    try {
      return await apiClient.post(`/users/my-patients/${entryId}/toggle_pin/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to toggle pin status'));
    }
  },

  /**
   * Update notes for a patient in the list
   * @param {string} entryId - List entry ID
   * @param {string} notes - New notes
   * @returns {Promise<Object>} Updated entry
   */
  updateNotes: async (entryId, notes) => {
    try {
      return await apiClient.patch(`/users/my-patients/${entryId}/update_notes/`, { notes });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update notes'));
    }
  },

  /**
   * Check if a patient is in user's list
   * @param {string} patientId - Patient ID to check
   * @returns {Promise<Object>} { in_list: boolean }
   */
  checkPatient: async (patientId) => {
    try {
      return await apiClient.get(`/users/my-patients/check_patient/?patient_id=${patientId}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to check patient status'));
    }
  },
};
