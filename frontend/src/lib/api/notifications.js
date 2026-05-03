import { apiClient, handleApiError } from '../api-client';

export const notificationsApi = {
  getInbox: async (params = {}, options = {}) => {
    try {
      return await apiClient.getWithPagination('/notifications/inbox/', {
        params,
        ...options,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
      throw new Error(handleApiError(error, 'Failed to fetch inbox'));
    }
  },

  getInboxCounts: async (options = {}) => {
    try {
      return await apiClient.get('/notifications/inbox/counts/', options);
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
      throw new Error(handleApiError(error, 'Failed to fetch inbox counts'));
    }
  },
};
