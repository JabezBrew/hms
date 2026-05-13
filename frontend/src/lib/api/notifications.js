import { apiClient, handleApiError } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api } from './v2/client';

function adaptV2Notification(item) {
  return {
    ...item,
    source_type: item.notification_type,
    summary: item.body,
    occurred_at: item.created_at,
    is_read: Boolean(item.read_at),
    status: item.read_at ? 'read' : 'unread',
    is_action_required: false,
    action_url: null,
  };
}

function adaptV2NotificationsList(response) {
  const results = Array.isArray(response?.data)
    ? response.data.map(adaptV2Notification)
    : [];
  return {
    results,
    count: results.length,
    next: response?.page?.next_cursor || null,
    previous: null,
    page: response?.page,
    count_exact: false,
  };
}

export const notificationsApi = {
  getInbox: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return adaptV2NotificationsList(await v2Api.getNotifications({
          query: {
            cursor: params.cursor,
            limit: Math.min(Number(params.limit || params.page_size || 50) || 50, 100),
            unread_only: params.status === 'unread' ? true : undefined,
          },
          signal: options.signal,
        }));
      }
      return await apiClient.getWithPagination('/notifications/inbox/', {
        params,
        ...options,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch inbox'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch inbox'));
    }
  },

  getInboxCounts: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getNotificationCounts({
          signal: options.signal,
        });
        return {
          unread: Number(response?.data?.unread || 0),
          action_required: Number(response?.data?.action_required || 0),
          total: Number(response?.data?.total || 0),
        };
      }
      return await apiClient.get('/notifications/inbox/counts/', options);
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch inbox counts'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch inbox counts'));
    }
  },

  markRead: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postNotificationRead({ id }, { read: true }, options);
        return adaptV2Notification(response?.data || {});
      }
      return await apiClient.post(`/notifications/inbox/${id}/mark-read/`, null, options);
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to mark inbox item read'));
      }
      throw new Error(handleApiError(error, 'Failed to mark inbox item read'));
    }
  },
};
