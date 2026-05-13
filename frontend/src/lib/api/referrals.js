/**
 * Referrals API service
 */
import { apiClient, handleApiError } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api } from './v2/client';

const DEFAULT_REFERRAL_PAGE_SIZE = 50;

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

function normalizeLimit(params = {}, fallback = DEFAULT_REFERRAL_PAGE_SIZE) {
  const rawLimit = params.limit || params.page_size || fallback;
  const parsed = Number.parseInt(String(rawLimit), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
}

function normalizePriority(value) {
  const normalized = String(value || 'routine').toLowerCase();
  if (normalized === 'emergency' || normalized === 'urgent' || normalized === 'routine') {
    return normalized;
  }
  return 'routine';
}

function mapV2ReferralStatus(status) {
  switch (status) {
    case 'sent':
      return 'pending';
    case 'cancelled':
      return 'declined';
    default:
      return status || 'pending';
  }
}

function mapUiReferralStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'pending') {
    return 'sent';
  }
  if (['sent', 'accepted', 'declined', 'completed', 'cancelled'].includes(normalized)) {
    return normalized;
  }
  return undefined;
}

function referralNumber(referral) {
  return `V2-REF-${String(referral?.id || '').slice(0, 8).toUpperCase()}`;
}

function splitDisplayName(displayName) {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return ['', ''];
  if (parts.length === 1) return [parts[0], ''];
  return [parts[0], parts.slice(1).join(' ')];
}

function adaptV2Referral(referral) {
  if (!referral) {
    return referral;
  }
  const [firstName, lastName] = splitDisplayName(referral.patient_display_name);
  return {
    ...referral,
    id: referral.id,
    patient: referral.patient_id,
    patient_id: referral.patient_id,
    patient_name: referral.patient_display_name,
    patient_mrn: referral.patient_code,
    patient_details: {
      id: referral.patient_id,
      first_name: firstName,
      last_name: lastName,
      medical_record_number: referral.patient_code,
    },
    referral_number: referral.referral_number || referralNumber(referral),
    referred_to_department: referral.to_service,
    referred_to_specialty: referral.to_service,
    urgency: normalizePriority(referral.priority),
    priority: normalizePriority(referral.priority),
    status: mapV2ReferralStatus(referral.status),
    v2_status: referral.status,
    reason: referral.reason || '',
    created_at: referral.created_at,
    updated_at: referral.updated_at || referral.created_at,
  };
}

function adaptV2ReferralList(response) {
  return (response?.data || []).map(adaptV2Referral);
}

function adaptV2ReferralCollection(response) {
  return { referrals: adaptV2ReferralList(response) };
}

function adaptV2WaitlistEntry(entry) {
  if (!entry) {
    return entry;
  }
  return {
    ...entry,
    patient: entry.patient_id,
    patient_id: entry.patient_id,
    patient_name: entry.patient_display_name,
    patient_mrn: entry.patient_code,
  };
}

function isV2ReferralNotification(item) {
  const type = String(item?.notification_type || '').toLowerCase();
  return type === 'referral' || type.startsWith('referral.');
}

function v2ReferralNotificationEvent(item) {
  const type = String(item?.notification_type || '').toLowerCase();
  const event = type.startsWith('referral.') ? type.slice('referral.'.length) : 'submitted';
  return ['submitted', 'accepted', 'declined', 'scheduled', 'completed'].includes(event)
    ? event
    : 'submitted';
}

function v2NotificationUrgency(priority) {
  switch (String(priority || '').toLowerCase()) {
    case 'high':
      return 'urgent';
    case 'low':
      return 'routine';
    default:
      return 'routine';
  }
}

function adaptV2ReferralNotification(item) {
  if (!item) {
    return item;
  }
  return {
    ...item,
    event: v2ReferralNotificationEvent(item),
    referral_number: item.title || `V2-NOTIF-${String(item.id || '').slice(0, 8).toUpperCase()}`,
    referred_to_department: item.body || 'Referrals',
    urgency: v2NotificationUrgency(item.priority),
    is_read: Boolean(item.read_at),
  };
}

function v2ReferralPayload(data = {}) {
  return {
    patient_id: data.patient_id || data.patient,
    to_service: data.to_service || data.referred_to_department || data.department || data.referred_to_specialty,
    priority: normalizePriority(data.priority || data.urgency),
    reason: data.reason || null,
  };
}

function v2WaitlistPayload(data = {}) {
  return {
    patient_id: data.patient_id || data.patient,
    service: data.service || data.referred_to_department || data.department,
    priority: normalizePriority(data.priority || data.urgency),
  };
}

function unsupportedInRustV2(message) {
  return new Error(message);
}

export const referralsApi = {
  /**
   * Get all referrals with optional filtering
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} List of referrals
   */
  getReferrals: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getReferrals({
          ...options,
          query: {
            cursor: params.cursor || params.next_cursor,
            limit: normalizeLimit(params),
          },
        });
        return adaptV2ReferralList(response);
      }
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

  getReferral: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getReferralById({ id }, options);
        return adaptV2Referral(response?.data);
      }
      return await apiClient.get(`/referrals/${id}/`, options);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch referral'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch referral'));
    }
  },

  createReferral: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postReferrals(v2ReferralPayload(data), options);
        return adaptV2Referral(response?.data);
      }
      return await apiClient.post('/referrals/', data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create referral'));
      }
      throw new Error(handleApiError(error, 'Failed to create referral'));
    }
  },

  updateReferral: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose referral edits yet.');
      }
      return await apiClient.patch(`/referrals/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update referral'));
    }
  },

  submitReferral: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        return referralsApi.getReferral(id);
      }
      return await apiClient.post(`/referrals/${id}/submit/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to submit referral'));
    }
  },

  acceptReferral: async (id, acceptanceNotes = '', options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postReferralAccept(
          { id },
          { acceptance_notes: acceptanceNotes || null },
          options,
        );
        return adaptV2Referral(response?.data);
      }
      return await apiClient.post(`/referrals/${id}/accept/`, {
        acceptance_notes: acceptanceNotes,
      });
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to accept referral'));
      }
      throw new Error(handleApiError(error, 'Failed to accept referral'));
    }
  },

  declineReferral: async (id, declineReason, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postReferralDecline(
          { id },
          { decline_reason: declineReason },
          options,
        );
        return adaptV2Referral(response?.data);
      }
      return await apiClient.post(`/referrals/${id}/decline/`, {
        decline_reason: declineReason,
      });
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to decline referral'));
      }
      throw new Error(handleApiError(error, 'Failed to decline referral'));
    }
  },

  scheduleReferral: async (id, appointmentId) => {
    try {
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose referral scheduling yet.');
      }
      return await apiClient.post(`/referrals/${id}/schedule/`, {
        scheduled_appointment_id: appointmentId,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to schedule referral'));
    }
  },

  completeReferral: async (id, specialistNotes, recommendations = '', options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postReferralComplete(
          { id },
          {
            specialist_notes: specialistNotes,
            recommendations: recommendations || null,
          },
          options,
        );
        return adaptV2Referral(response?.data);
      }
      return await apiClient.post(`/referrals/${id}/complete/`, {
        specialist_notes: specialistNotes,
        recommendations: recommendations,
      });
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to complete referral'));
      }
      throw new Error(handleApiError(error, 'Failed to complete referral'));
    }
  },

  startConsultation: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        return referralsApi.getReferral(id);
      }
      return await apiClient.post(`/referrals/${id}/start-consultation/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to start consultation'));
    }
  },

  updateReferralResponse: async (id, specialistNotes, recommendations = '', options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return referralsApi.completeReferral(id, specialistNotes, recommendations, options);
      }
      return await apiClient.patch(`/referrals/${id}/update_response/`, {
        specialist_notes: specialistNotes,
        recommendations: recommendations,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update referral response'));
    }
  },

  getReferralInbox: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getReferrals({
          ...options,
          query: { limit: DEFAULT_REFERRAL_PAGE_SIZE },
        });
        return adaptV2ReferralCollection(response);
      }
      return await apiClient.get('/referrals/inbox/', options);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch referral inbox'));
    }
  },

  getReferralInboxCount: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getReferrals({
          ...options,
          query: { limit: DEFAULT_REFERRAL_PAGE_SIZE, status: 'sent' },
        });
        return adaptV2ReferralList(response).filter((referral) => referral.status === 'pending').length;
      }
      const response = await apiClient.get('/referrals/inbox-count/', options);
      return response?.count || 0;
    } catch (error) {
      // Return 0 on error to avoid breaking the UI
      console.error('Failed to fetch referral inbox count:', error);
      return 0;
    }
  },

  getReferralsSent: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getReferrals({
          ...options,
          query: { limit: DEFAULT_REFERRAL_PAGE_SIZE },
        });
        return adaptV2ReferralCollection(response);
      }
      return await apiClient.get('/referrals/sent/', options);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch sent referrals'));
    }
  },

  getPendingReferrals: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getReferrals({
          ...options,
          query: { limit: DEFAULT_REFERRAL_PAGE_SIZE, status: mapUiReferralStatus('pending') },
        });
        return adaptV2ReferralList(response);
      }
      return await apiClient.get('/referrals/pending/', options);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch pending referrals'));
    }
  },

  getReferralSlaState: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getReferralSlaState({ id }, options);
        return { sla_state: response?.data || null };
      }
      return await apiClient.get(`/referrals/${id}/sla-state/`, options);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch referral SLA state'));
    }
  },

  evaluateReferralSla: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        return referralsApi.getReferralSlaState(id);
      }
      return await apiClient.post(`/referrals/${id}/evaluate-sla/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to evaluate referral SLA'));
    }
  },

  getReferralSlaDashboard: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getReferralSlaDashboard(options);
        return response?.data || { risk_summary: { total: 0, open: 0, breached: 0, due_soon: 0 } };
      }
      return await apiClient.get('/referrals/sla-dashboard/', options);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch referral SLA dashboard'));
    }
  },

  getClinicWaitlist: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getClinicWaitlist({
          ...options,
          query: {
            cursor: params.cursor || params.next_cursor,
            limit: normalizeLimit(params),
          },
        });
        return (response?.data || []).map(adaptV2WaitlistEntry);
      }
      return await apiClient.get('/referrals/clinic-waitlist/', { ...options, params });
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch clinic waitlist'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch clinic waitlist'));
    }
  },

  createClinicWaitlistEntry: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postClinicWaitlist(v2WaitlistPayload(data), options);
        return adaptV2WaitlistEntry(response?.data);
      }
      return await apiClient.post('/referrals/clinic-waitlist/', data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create waitlist entry'));
      }
      throw new Error(handleApiError(error, 'Failed to create waitlist entry'));
    }
  },

  offerNextClinicWaitlistEntry: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postClinicWaitlistOfferNext(
          { service: data?.service || data?.department || data?.referred_to_department },
          options,
        );
        return adaptV2WaitlistEntry(response?.data);
      }
      return await apiClient.post('/referrals/clinic-waitlist/offer-next/', data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to offer next waitlist entry'));
      }
      throw new Error(handleApiError(error, 'Failed to offer next waitlist entry'));
    }
  },

  promoteClinicWaitlistEntry: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose clinic waitlist promotion yet.');
      }
      return await apiClient.post(`/referrals/clinic-waitlist/${id}/promote/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to promote waitlist entry'));
    }
  },

  cancelClinicWaitlistEntry: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose clinic waitlist cancellation yet.');
      }
      return await apiClient.post(`/referrals/clinic-waitlist/${id}/cancel/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to cancel waitlist entry'));
    }
  },

  getClinicWaitlistSummary: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getClinicWaitlist({
          ...options,
          query: { limit: DEFAULT_REFERRAL_PAGE_SIZE },
        });
        const rowsByService = new Map();
        for (const entry of response?.data || []) {
          const service = entry.service || 'Unassigned';
          const current = rowsByService.get(service) || { service, total: 0 };
          current.total += entry.status === 'waiting' ? 1 : 0;
          rowsByService.set(service, current);
        }
        return { rows: Array.from(rowsByService.values()) };
      }
      return await apiClient.get('/referrals/clinic-waitlist/summary/', options);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch waitlist summary'));
    }
  },

  // Notification endpoints
  getNotifications: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getNotifications({
          query: {
            cursor: params.cursor || params.next_cursor,
            limit: normalizeLimit(params, 20),
            unread_only: params.status === 'unread' ? true : undefined,
          },
          signal: options.signal,
        });
        return (response?.data || [])
          .filter(isV2ReferralNotification)
          .map(adaptV2ReferralNotification);
      }
      const response = await apiClient.getWithPagination('/referrals/notifications/', {
        ...options,
        params,
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch referral notifications'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch referral notifications'));
    }
  },

  markNotificationRead: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postNotificationRead(
          { id },
          { read: true },
          { signal: options.signal },
        );
        return adaptV2ReferralNotification(response?.data);
      }
      return await apiClient.post(`/referrals/notifications/${id}/mark-read/`, {});
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to mark notification as read'));
      }
      throw new Error(handleApiError(error, 'Failed to mark notification as read'));
    }
  },

  getUnreadNotificationCount: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getNotifications({
          query: {
            limit: DEFAULT_REFERRAL_PAGE_SIZE * 2,
            unread_only: true,
          },
          signal: options.signal,
        });
        return (response?.data || []).filter(isV2ReferralNotification).length;
      }
      const response = await apiClient.get('/referrals/notifications/unread-count/');
      return response?.count || 0;
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        return 0;
      }
      // Return 0 on error to avoid breaking the UI
      console.error('Failed to fetch unread count:', error);
      return 0;
    }
  },
};
