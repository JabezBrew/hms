/**
 * Referrals API service
 */
import { apiClient, handleApiError } from '../api-client';

export const referralsApi = {
  /**
   * Get all referrals with optional filtering
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} List of referrals
   */
  getReferrals: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/referrals/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getAll(endpoint);
    } catch (error) {
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
};
