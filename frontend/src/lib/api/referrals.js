/**
 * Referrals API service
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

export const referralsApi = {
  /**
   * Get all referrals with optional filtering
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} List of referrals
   */
  getReferrals: async (params = {}, options = {}) => {
    try {
      const response = await apiClient.getWithPagination('/referrals/', {
        ...options,
        params,
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch referrals'));
    }
  },

  getReferral: async (id) => {
    try {
      return await apiClient.get(`/referrals/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch referral'));
    }
  },

  createReferral: async (data) => {
    try {
      return await apiClient.post('/referrals/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create referral'));
    }
  },

  updateReferral: async (id, data) => {
    try {
      return await apiClient.put(`/referrals/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update referral'));
    }
  },

  submitReferral: async (id) => {
    try {
      return await apiClient.post(`/referrals/${id}/submit/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to submit referral'));
    }
  },

  acceptReferral: async (id, acceptanceNotes = '') => {
    try {
      return await apiClient.post(`/referrals/${id}/accept/`, {
        acceptance_notes: acceptanceNotes,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to accept referral'));
    }
  },

  declineReferral: async (id, declineReason) => {
    try {
      return await apiClient.post(`/referrals/${id}/decline/`, {
        decline_reason: declineReason,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to decline referral'));
    }
  },

  scheduleReferral: async (id, appointmentId) => {
    try {
      return await apiClient.post(`/referrals/${id}/schedule/`, {
        scheduled_appointment_id: appointmentId,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to schedule referral'));
    }
  },

  completeReferral: async (id, specialistNotes, recommendations = '') => {
    try {
      return await apiClient.post(`/referrals/${id}/complete/`, {
        specialist_notes: specialistNotes,
        recommendations: recommendations,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to complete referral'));
    }
  },

  startConsultation: async (id) => {
    try {
      return await apiClient.post(`/referrals/${id}/start-consultation/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to start consultation'));
    }
  },

  updateReferralResponse: async (id, specialistNotes, recommendations = '') => {
    try {
      return await apiClient.patch(`/referrals/${id}/update_response/`, {
        specialist_notes: specialistNotes,
        recommendations: recommendations,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update referral response'));
    }
  },

  getReferralInbox: async () => {
    try {
      return await apiClient.get('/referrals/inbox/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch referral inbox'));
    }
  },

  getReferralInboxCount: async () => {
    try {
      const response = await apiClient.get('/referrals/inbox-count/');
      return response?.count || 0;
    } catch (error) {
      // Return 0 on error to avoid breaking the UI
      console.error('Failed to fetch referral inbox count:', error);
      return 0;
    }
  },

  getReferralsSent: async () => {
    try {
      return await apiClient.get('/referrals/sent/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch sent referrals'));
    }
  },

  getPendingReferrals: async () => {
    try {
      return await apiClient.get('/referrals/pending/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch pending referrals'));
    }
  },

  getReferralSlaState: async (id) => {
    try {
      return await apiClient.get(`/referrals/${id}/sla-state/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch referral SLA state'));
    }
  },

  evaluateReferralSla: async (id) => {
    try {
      return await apiClient.post(`/referrals/${id}/evaluate-sla/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to evaluate referral SLA'));
    }
  },

  getReferralSlaDashboard: async () => {
    try {
      return await apiClient.get('/referrals/sla-dashboard/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch referral SLA dashboard'));
    }
  },

  getClinicWaitlist: async (params = {}) => {
    try {
      return await apiClient.get('/referrals/clinic-waitlist/', { params });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch clinic waitlist'));
    }
  },

  createClinicWaitlistEntry: async (data) => {
    try {
      return await apiClient.post('/referrals/clinic-waitlist/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create waitlist entry'));
    }
  },

  offerNextClinicWaitlistEntry: async (data) => {
    try {
      return await apiClient.post('/referrals/clinic-waitlist/offer-next/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to offer next waitlist entry'));
    }
  },

  promoteClinicWaitlistEntry: async (id, data) => {
    try {
      return await apiClient.post(`/referrals/clinic-waitlist/${id}/promote/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to promote waitlist entry'));
    }
  },

  cancelClinicWaitlistEntry: async (id) => {
    try {
      return await apiClient.post(`/referrals/clinic-waitlist/${id}/cancel/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to cancel waitlist entry'));
    }
  },

  getClinicWaitlistSummary: async () => {
    try {
      return await apiClient.get('/referrals/clinic-waitlist/summary/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch waitlist summary'));
    }
  },

  // Notification endpoints
  getNotifications: async (params = {}, options = {}) => {
    try {
      const response = await apiClient.getWithPagination('/referrals/notifications/', {
        ...options,
        params,
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch referral notifications'));
    }
  },

  markNotificationRead: async (id) => {
    try {
      return await apiClient.post(`/referrals/notifications/${id}/mark-read/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to mark notification as read'));
    }
  },

  getUnreadNotificationCount: async () => {
    try {
      const response = await apiClient.get('/referrals/notifications/unread-count/');
      return response?.count || 0;
    } catch (error) {
      // Return 0 on error to avoid breaking the UI
      console.error('Failed to fetch unread count:', error);
      return 0;
    }
  },
};
