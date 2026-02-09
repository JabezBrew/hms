import { apiClient, handleApiError } from '../api-client';

function buildQueryString(params = {}) {
  const cleanParams = Object.entries(params).reduce((acc, [key, value]) => {
    if (value === undefined || value === null || value === '') {
      return acc;
    }
    acc[key] = String(value);
    return acc;
  }, {});
  const queryString = new URLSearchParams(cleanParams).toString();
  return queryString ? `?${queryString}` : '';
}

/**
 * Dashboards API service
 */
export const dashboardsApi = {
  /**
   * Get nurse dashboard data
   * @param {Object} params - Query parameters (ward, etc.)
   * @returns {Promise<Object>} Nurse dashboard data
   */
  getNurseDashboard: async (params = {}) => {
    try {
      const endpoint = `/dashboards/nurse/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch nurse dashboard'));
    }
  },

  /**
   * Get inpatient doctor dashboard data
   * @returns {Promise<Object>} Inpatient doctor dashboard data
   */
  getInpatientDashboard: async () => {
    try {
      return await apiClient.get('/dashboards/inpatient/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch inpatient dashboard'));
    }
  },

  /**
   * Get receptionist dashboard data
   * @returns {Promise<Object>} Receptionist dashboard data
   */
  getReceptionistDashboard: async () => {
    try {
      return await apiClient.get('/dashboards/reception/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch receptionist dashboard'));
    }
  },

  /**
   * Get admin dashboard data
   * @returns {Promise<Object>} Admin dashboard data
   */
  getAdminDashboard: async () => {
    try {
      return await apiClient.get('/dashboards/admin/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch admin dashboard'));
    }
  },

  /**
   * Get outpatient doctor dashboard data (my work)
   * @param {Object} params - Query parameters (date, etc.)
   * @returns {Promise<Object>} Outpatient doctor dashboard data
   */
  getMyWorkDashboard: async (params = {}) => {
    try {
      const endpoint = `/dashboards/my-work/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch my work dashboard'));
    }
  },

  /**
   * Get clinic schedule dashboard data
   * @param {Object} params - Query parameters (date, practitioner_id, etc.)
   * @returns {Promise<Object>} Clinic schedule data
   */
  getClinicSchedule: async (params = {}) => {
    try {
      const endpoint = `/dashboards/clinic/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch clinic schedule'));
    }
  },

  /**
   * Get admin v2 dashboard summary payload
   * @param {Object} params - Query parameters (window, expand)
   * @returns {Promise<Object>} Admin dashboard v2 summary data
   */
  getAdminDashboardV2: async (params = {}) => {
    try {
      const endpoint = `/dashboards/admin-v2/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch admin dashboard summary'));
    }
  },

  /**
   * Get admin v2 capacity section detail payload
   * @param {Object} params - Query parameters (window)
   * @returns {Promise<Object>} Admin dashboard v2 capacity detail
   */
  getAdminDashboardV2Capacity: async (params = {}) => {
    try {
      const endpoint = `/dashboards/admin-v2/capacity/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch admin capacity details'));
    }
  },

  /**
   * Get admin v2 workforce section detail payload
   * @param {Object} params - Query parameters (window)
   * @returns {Promise<Object>} Admin dashboard v2 workforce detail
   */
  getAdminDashboardV2Workforce: async (params = {}) => {
    try {
      const endpoint = `/dashboards/admin-v2/workforce/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch admin workforce details'));
    }
  },

  /**
   * Get admin v2 compliance section detail payload
   * @param {Object} params - Query parameters (window)
   * @returns {Promise<Object>} Admin dashboard v2 compliance detail
   */
  getAdminDashboardV2Compliance: async (params = {}) => {
    try {
      const endpoint = `/dashboards/admin-v2/compliance/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch admin compliance details'));
    }
  },
};
