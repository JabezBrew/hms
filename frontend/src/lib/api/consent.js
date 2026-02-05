import { apiClient, handleApiError } from '../api-client';

export const consentApi = {
  createReferral: async (payload) => {
    try {
      return await apiClient.post('/consent/referrals/', payload);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create referral'));
    }
  },

  createConsentGrant: async (payload) => {
    try {
      return await apiClient.post('/consent/grants/', payload);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to grant consent'));
    }
  },

  issueAccessToken: async (consentId, payload) => {
    try {
      return await apiClient.post(`/consent/grants/${consentId}/issue_token/`, payload);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to issue access token'));
    }
  },
};
