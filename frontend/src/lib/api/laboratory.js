/**
 * Laboratory API service
 */
import { apiClient, handleApiError } from '../api-client';

export const laboratoryApi = {
  // ========== Lab Tests ==========

  /**
   * Get all lab tests with optional filtering
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} List of lab tests
   */
  getLabTests: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/laboratory/tests/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getAll(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch lab tests'));
    }
  },

  getLabTest: async (id) => {
    try {
      return await apiClient.get(`/laboratory/tests/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch lab test'));
    }
  },

  /**
   * Create a custom lab test
   * @param {Object} data - Test data
   * @returns {Promise<Object>} Created test
   */
  createLabTest: async (data) => {
    try {
      return await apiClient.post('/laboratory/tests/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create lab test'));
    }
  },

  /**
   * Update a lab test
   * @param {string} id - Test ID
   * @param {Object} data - Update data
   * @returns {Promise<Object>} Updated test
   */
  updateLabTest: async (id, data) => {
    try {
      return await apiClient.patch(`/laboratory/tests/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update lab test'));
    }
  },

  /**
   * Customize a lab test's facility-specific values
   * @param {string} id - Test ID
   * @param {Object} data - Customization data (price, reference_ranges, tat_hours, is_active)
   * @returns {Promise<Object>} Updated test
   */
  customizeLabTest: async (id, data) => {
    try {
      return await apiClient.post(`/laboratory/tests/${id}/customize/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to customize lab test'));
    }
  },

  /**
   * Reset a lab test to system defaults
   * @param {string} id - Test ID
   * @returns {Promise<Object>} Reset test
   */
  resetLabTestToDefaults: async (id) => {
    try {
      return await apiClient.post(`/laboratory/tests/${id}/reset_to_defaults/`, { confirm: true });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to reset lab test'));
    }
  },

  /**
   * Delete a custom lab test (only works for non-system tests)
   * @param {string} id - Test ID
   * @returns {Promise<void>}
   */
  deleteLabTest: async (id) => {
    try {
      return await apiClient.delete(`/laboratory/tests/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete lab test'));
    }
  },

  // ========== Lab Panels ==========

  getLabPanels: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/laboratory/panels/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getAll(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch lab panels'));
    }
  },

  getLabPanel: async (id) => {
    try {
      return await apiClient.get(`/laboratory/panels/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch lab panel'));
    }
  },

  /**
   * Create a custom lab panel
   * @param {Object} data - Panel data
   * @returns {Promise<Object>} Created panel
   */
  createLabPanel: async (data) => {
    try {
      return await apiClient.post('/laboratory/panels/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create lab panel'));
    }
  },

  /**
   * Update a lab panel
   * @param {string} id - Panel ID
   * @param {Object} data - Update data
   * @returns {Promise<Object>} Updated panel
   */
  updateLabPanel: async (id, data) => {
    try {
      return await apiClient.patch(`/laboratory/panels/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update lab panel'));
    }
  },

  /**
   * Customize a lab panel's facility-specific values
   * @param {string} id - Panel ID
   * @param {Object} data - Customization data (price, is_active)
   * @returns {Promise<Object>} Updated panel
   */
  customizeLabPanel: async (id, data) => {
    try {
      return await apiClient.post(`/laboratory/panels/${id}/customize/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to customize lab panel'));
    }
  },

  /**
   * Reset a lab panel to system defaults
   * @param {string} id - Panel ID
   * @returns {Promise<Object>} Reset panel
   */
  resetLabPanelToDefaults: async (id) => {
    try {
      return await apiClient.post(`/laboratory/panels/${id}/reset_to_defaults/`, { confirm: true });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to reset lab panel'));
    }
  },

  /**
   * Delete a custom lab panel (only works for non-system panels)
   * @param {string} id - Panel ID
   * @returns {Promise<void>}
   */
  deleteLabPanel: async (id) => {
    try {
      return await apiClient.delete(`/laboratory/panels/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete lab panel'));
    }
  },

  // ========== Lab Orders ==========

  getLabOrders: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/laboratory/orders/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getAll(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch lab orders'));
    }
  },

  getLabOrder: async (id) => {
    try {
      return await apiClient.get(`/laboratory/orders/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch lab order'));
    }
  },

  createLabOrder: async (data) => {
    try {
      return await apiClient.post('/laboratory/orders/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create lab order'));
    }
  },

  updateLabOrder: async (id, data) => {
    try {
      return await apiClient.put(`/laboratory/orders/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update lab order'));
    }
  },

  submitLabOrder: async (id) => {
    try {
      return await apiClient.post(`/laboratory/orders/${id}/submit/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to submit lab order'));
    }
  },

  collectLabOrder: async (id) => {
    try {
      return await apiClient.post(`/laboratory/orders/${id}/collect/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to mark order as collected'));
    }
  },

  receiveLabOrder: async (id) => {
    try {
      return await apiClient.post(`/laboratory/orders/${id}/receive/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to receive order'));
    }
  },

  startProcessingLabOrder: async (id) => {
    try {
      return await apiClient.post(`/laboratory/orders/${id}/start_processing/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to start processing'));
    }
  },

  completeLabOrder: async (id) => {
    try {
      return await apiClient.post(`/laboratory/orders/${id}/complete/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to complete order'));
    }
  },

  cancelLabOrder: async (id, cancellationReason) => {
    try {
      return await apiClient.post(`/laboratory/orders/${id}/cancel/`, {
        cancellation_reason: cancellationReason,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to cancel order'));
    }
  },

  // ========== Lab Specimens ==========

  getLabSpecimens: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/laboratory/specimens/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getAll(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch specimens'));
    }
  },

  getLabSpecimen: async (id) => {
    try {
      return await apiClient.get(`/laboratory/specimens/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch specimen'));
    }
  },

  createLabSpecimen: async (data) => {
    try {
      return await apiClient.post('/laboratory/specimens/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create specimen'));
    }
  },

  receiveLabSpecimen: async (id, data) => {
    try {
      return await apiClient.post(`/laboratory/specimens/${id}/receive/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to receive specimen'));
    }
  },

  // ========== Lab Results ==========

  getLabResults: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/laboratory/results/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getAll(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch lab results'));
    }
  },

  getLabResult: async (id) => {
    try {
      return await apiClient.get(`/laboratory/results/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch lab result'));
    }
  },

  createLabResult: async (data) => {
    try {
      return await apiClient.post('/laboratory/results/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create lab result'));
    }
  },

  verifyLabResult: async (id, verificationNotes = '') => {
    try {
      return await apiClient.post(`/laboratory/results/${id}/verify/`, {
        verification_notes: verificationNotes,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to verify result'));
    }
  },

  /**
   * Create multiple lab results in bulk
   * @param {Object} data - Bulk result data
   * @param {string} data.order_id - Lab order ID
   * @param {string} data.specimen_id - Specimen ID
   * @param {Array} data.results - Array of result items
   * @returns {Promise<Object>} Created results response
   */
  bulkCreateResults: async (data) => {
    try {
      return await apiClient.post('/laboratory/results/bulk/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to save lab results'));
    }
  },

  /**
   * Verify multiple lab results in bulk
   * @param {Object} data - Bulk verify data
   * @param {Array} data.result_ids - Array of result IDs to verify (optional if order_id provided)
   * @param {string} data.order_id - Order ID to verify all results (optional if result_ids provided)
   * @param {string} data.verification_notes - Optional notes
   * @returns {Promise<Object>} Verification response
   */
  bulkVerifyResults: async (data) => {
    try {
      return await apiClient.post('/laboratory/results/bulk-verify/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to verify lab results'));
    }
  },
};
