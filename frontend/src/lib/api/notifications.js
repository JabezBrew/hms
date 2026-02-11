import { apiClient, handleApiError } from '../api-client';

export const notificationsApi = {
  getInbox: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/notifications/inbox/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch inbox'));
    }
  },
};
