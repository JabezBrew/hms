/**
 * Visits API client for outpatient visit lifecycle and triage queue management.
 */
import { apiClient } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api } from './v2/client';

const DEFAULT_VISIT_PAGE_SIZE = 50;

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function splitDisplayName(displayName) {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return ['', ''];
  }
  if (parts.length === 1) {
    return [parts[0], ''];
  }
  return [parts[0], parts.slice(1).join(' ')];
}

function normalizeLimit(params = {}, fallback = DEFAULT_VISIT_PAGE_SIZE) {
  const rawLimit = params.limit || params.page_size || fallback;
  const parsed = Number.parseInt(String(rawLimit), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
}

function queryParamsWithoutSignal(params = {}) {
  const queryParams = { ...(params || {}) };
  delete queryParams.signal;
  return queryParams;
}

function unsupportedInRustV2(message) {
  return new Error(message);
}

function adaptV2Visit(visit, index = 0) {
  if (!visit) {
    return visit;
  }

  const [firstName, lastName] = splitDisplayName(visit.patient_display_name);

  return {
    id: visit.id,
    visit_id: visit.id,
    encounter_id: visit.id,
    patient: visit.patient_id,
    patient_id: visit.patient_id,
    patient_name: visit.patient_display_name,
    patient_identifier: visit.patient_code,
    patient_mrn: visit.patient_code,
    patient_details: {
      id: visit.patient_id,
      user_details: {
        first_name: firstName,
        last_name: lastName,
      },
    },
    appointment: visit.appointment_id || null,
    appointment_id: visit.appointment_id || null,
    clinic_id: visit.clinic_id || null,
    queue_number: index + 1,
    visit_status: visit.status,
    v2_status: visit.status,
    checked_in_at: visit.checked_in_at,
  };
}

export function adaptV2VisitForBridge(visit, index = 0) {
  return adaptV2Visit(visit, index);
}

function adaptV2VisitListResponse(response) {
  return Array.isArray(response?.data)
    ? response.data.map((visit, index) => adaptV2Visit(visit, index))
    : [];
}

function adaptV2TriageStatus(status) {
  if (status === 'completed') {
    return 'triaged';
  }
  return status || 'waiting';
}

function adaptV2TriageEntry(entry) {
  if (!entry) {
    return entry;
  }

  return {
    id: entry.id,
    visit_id: entry.visit_id,
    patient: entry.patient_id,
    patient_id: entry.patient_id,
    patient_name: entry.patient_display_name,
    patient_identifier: entry.patient_code,
    patient_mrn: entry.patient_code,
    priority: entry.acuity,
    acuity: entry.acuity,
    status: adaptV2TriageStatus(entry.status),
    v2_status: entry.status,
    chief_complaint: '',
    triage_notes: '',
    created_at: entry.created_at,
  };
}

function adaptV2TriageListResponse(response, params = {}) {
  const limit = Number(response?.page?.limit || params.page_size || params.limit || DEFAULT_VISIT_PAGE_SIZE);
  const currentPage = Number(params.page || 1);
  let results = Array.isArray(response?.data) ? response.data.map(adaptV2TriageEntry) : [];
  if (params.priority && params.priority !== 'all') {
    results = results.filter((entry) => entry.priority === params.priority);
  }
  if (params.status && params.status !== 'all') {
    results = results.filter((entry) => entry.status === params.status);
  }
  const hasNext = Boolean(response?.page?.has_next && response?.page?.next_cursor);
  const estimatedTotal = ((currentPage - 1) * limit) + results.length + (hasNext ? 1 : 0);

  return {
    results,
    page: currentPage,
    page_size: limit,
    count: estimatedTotal,
    total: estimatedTotal,
    count_exact: false,
    next: hasNext ? response.page.next_cursor : null,
    previous: currentPage > 1 ? String(currentPage - 1) : null,
    next_cursor: response?.page?.next_cursor || null,
  };
}

function normalizeTriagePayload(data = {}) {
  return {
    visit_id: data.visit_id || data.visit,
    acuity: data.acuity || data.priority || 'routine',
  };
}

// =============================================================================
// Outpatient Visits API
// =============================================================================

/**
 * Outpatient Visit Actions API
 * All actions are keyed by encounter_id (the visit is looked up via encounter)
 */
export const visitsApi = {
  /**
   * Get visit details for an encounter
   */
  get: async (encounterId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getVisitById({ id: encounterId }, { signal: options.signal });
        return adaptV2Visit(response?.data);
      }

      return await apiClient.get(`/encounters/visits/${encounterId}/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch visit'));
      }
      throw error;
    }
  },

  /**
   * Move patient from checked_in to waiting status
   */
  addToWaiting: async (encounterId) => {
    if (isRustV2ApiMode()) {
      throw unsupportedInRustV2('Rust V2 check-in creates waiting-room visits directly.');
    }
    return apiClient.post(`/encounters/visits/${encounterId}/add_to_waiting/`);
  },

  /**
   * Call a waiting patient (waiting -> called)
   */
  call: async (encounterId) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postVisitCall({ id: encounterId });
        return adaptV2Visit(response?.data);
      }
      return await apiClient.post(`/encounters/visits/${encounterId}/call/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to call patient'));
      }
      throw error;
    }
  },

  /**
   * Start consultation (called/checked_in/on_hold -> in_progress)
   */
  startConsultation: async (encounterId) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postVisitStartConsultation({ id: encounterId });
        return adaptV2Visit(response?.data);
      }
      return await apiClient.post(`/encounters/visits/${encounterId}/start_consultation/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to start consultation'));
      }
      throw error;
    }
  },

  /**
   * Put consultation on hold (in_progress -> on_hold)
   */
  hold: async (encounterId) => {
    if (isRustV2ApiMode()) {
      throw unsupportedInRustV2('Rust V2 does not expose visit hold yet.');
    }
    return apiClient.post(`/encounters/visits/${encounterId}/hold/`);
  },

  /**
   * End consultation (in_progress -> ready_checkout)
   */
  endConsultation: async (encounterId) => {
    if (isRustV2ApiMode()) {
      throw unsupportedInRustV2('Rust V2 does not expose ready-checkout transition yet.');
    }
    return apiClient.post(`/encounters/visits/${encounterId}/end_consultation/`);
  },

  /**
   * Checkout patient (ready_checkout/in_progress -> checked_out)
   * @param {string} encounterId - The encounter UUID
   * @param {boolean} force - Force checkout even if requirements not met (admin only)
   */
  checkout: async (encounterId, force = false) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postVisitCheckout({ id: encounterId });
        return adaptV2Visit(response?.data);
      }
      return await apiClient.post(`/encounters/visits/${encounterId}/checkout/`, { force });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to checkout patient'));
      }
      throw error;
    }
  },

  /**
   * Mark patient as no-show (waiting/checked_in -> no_show)
   */
  noShow: async (encounterId) => {
    if (isRustV2ApiMode()) {
      throw unsupportedInRustV2('Rust V2 does not expose no-show transition yet.');
    }
    return apiClient.post(`/encounters/visits/${encounterId}/no_show/`);
  },

  /**
   * Get waiting room queue for a clinic
   * Returns list of visits with status waiting or called
   * @param {string} clinicId - The clinic UUID
   */
  waitingRoom: async (clinicId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getVisits({
          query: {
            limit: normalizeLimit(options),
            clinic_id: clinicId,
          },
          signal: options.signal,
        });
        return adaptV2VisitListResponse(response);
      }

      return await apiClient.get('/encounters/visits/waiting_room/', { params: { clinic: clinicId } });
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch waiting room'));
      }
      throw error;
    }
  },
};

// =============================================================================
// Triage Queue API
// =============================================================================

/**
 * Triage Queue API for walk-in patient management
 */
export const triageApi = {
  /**
   * List triage queue entries
   * @param {Object} params - Query parameters (status, priority)
   */
  list: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getTriageQueue({
          query: {
            limit: normalizeLimit(params),
            cursor: params.cursor || params.next_cursor,
          },
          signal: params.signal,
        });
        return adaptV2TriageListResponse(response, params);
      }

      return await apiClient.get('/encounters/triage/', { params: queryParamsWithoutSignal(params) });
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch triage queue'));
      }
      throw error;
    }
  },

  /**
   * Get single triage entry
   */
  get: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getTriage({ id }, { signal: options.signal });
        return adaptV2TriageEntry(response?.data);
      }
      return apiClient.get(`/encounters/triage/${id}/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch triage entry'));
      }
      throw error;
    }
  },

  /**
   * Add patient to triage queue
   * @param {Object} data - { patient: uuid, priority: string, chief_complaint: string }
   */
  create: async (data) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postTriage(normalizeTriagePayload(data));
        return adaptV2TriageEntry(response?.data);
      }
      return await apiClient.post('/encounters/triage/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to add patient to triage queue'));
      }
      throw error;
    }
  },

  /**
   * Perform triage assessment
   * @param {string} id - Triage entry UUID
   * @param {Object} data - { priority: string, notes: string }
   */
  triage: async (id, data) => {
    if (isRustV2ApiMode()) {
      throw unsupportedInRustV2('Rust V2 does not expose triage assessment updates yet.');
    }
    return apiClient.post(`/encounters/triage/${id}/triage/`, data);
  },

  /**
   * Assign triaged patient to a clinic
   * @param {string} id - Triage entry UUID
   * @param {Object} data - { clinic_id, appointment_type_id, start_time, practitioner_id? }
   */
  assign: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        const assignedTo = data.assigned_to_user_id || data.practitioner_id;
        if (!assignedTo) {
          throw unsupportedInRustV2('Rust V2 triage assignment requires a practitioner.');
        }
        const response = await v2Api.postTriageAssign({ id }, { assigned_to_user_id: assignedTo });
        return adaptV2TriageEntry(response?.data);
      }
      return await apiClient.post(`/encounters/triage/${id}/assign/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to assign triage entry'));
      }
      throw error;
    }
  },

  /**
   * Cancel triage entry (only if not yet assigned)
   */
  cancel: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postTriageCancel({ id });
        return adaptV2TriageEntry(response?.data);
      }
      return apiClient.post(`/encounters/triage/${id}/cancel/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to cancel triage entry'));
      }
      throw error;
    }
  },
};

export default {
  visits: visitsApi,
  triage: triageApi,
};
