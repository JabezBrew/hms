/**
 * Visits API client for outpatient visit lifecycle and triage queue management.
 */
import { apiClient } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api } from './v2/client';
import {
  cacheCursorForNextPage as cacheScopedCursorForNextPage,
  resolveCursorPage as resolveScopedCursorPage,
} from './v2/cursorCache';

const DEFAULT_VISIT_PAGE_SIZE = 50;
const triageCursorCache = new Map();

function resolveCursorPage(scope, params = {}) {
  return resolveScopedCursorPage(triageCursorCache, `visits:${scope}`, params);
}

function cacheCursorForNextPage(scope, params, response) {
  cacheScopedCursorForNextPage(triageCursorCache, `visits:${scope}`, params, response);
}

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
    encounter_id: visit.encounter_id || null,
    encounter: visit.encounter_id || null,
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

function v2TriageStatusFromUi(status) {
  if (!status || status === 'all') {
    return undefined;
  }
  if (status === 'triaged') {
    return 'completed';
  }
  return status;
}

function v2TriageAcuityFromUi(priority) {
  if (!priority || priority === 'all') {
    return undefined;
  }
  return priority;
}

function adaptV2TriageEntry(entry) {
  if (!entry) {
    return entry;
  }

  return {
    id: entry.id,
    visit_id: entry.visit_id,
    encounter_id: entry.encounter_id || null,
    encounter: entry.encounter_id || null,
    patient: entry.patient_id,
    patient_id: entry.patient_id,
    patient_name: entry.patient_display_name,
    patient_identifier: entry.patient_code,
    patient_mrn: entry.patient_code,
    priority: entry.acuity,
    acuity: entry.acuity,
    status: adaptV2TriageStatus(entry.status),
    v2_status: entry.status,
    assigned_to_user_id: entry.assigned_to_user_id || null,
    assigned_to_name: entry.assigned_to_name || null,
    assigned_to: entry.assigned_to_user_id || null,
    assigned_to_display: entry.assigned_to_name || null,
    chief_complaint: '',
    triage_notes: entry.triage_notes || '',
    created_at: entry.created_at,
  };
}

function adaptV2TriageListResponse(response, params = {}) {
  const limit = Number(response?.page?.limit || params.page_size || params.limit || DEFAULT_VISIT_PAGE_SIZE);
  const resolvedPage = resolveCursorPage('triage', params);
  const currentPage = resolvedPage.page;
  const results = Array.isArray(response?.data) ? response.data.map(adaptV2TriageEntry) : [];
  const hasNext = Boolean(response?.page?.has_next && response?.page?.next_cursor);
  const estimatedTotal = ((currentPage - 1) * limit) + results.length + (hasNext ? 1 : 0);

  cacheCursorForNextPage('triage', params, response);

  return {
    results,
    page: currentPage,
    current_page: currentPage,
    requested_page: resolvedPage.requestedPage ?? currentPage,
    resolved_page: currentPage,
    cursor_missing: Boolean(resolvedPage.cursorMissing),
    page_size: limit,
    count: estimatedTotal,
    total: estimatedTotal,
    count_exact: !hasNext,
    total_pages: hasNext ? currentPage + 1 : Math.max(1, currentPage),
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
  call: async (encounterId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postVisitCall(
          { id: encounterId },
          { signal: options.signal },
        );
        return adaptV2Visit(response?.data);
      }
      return await apiClient.post(`/encounters/visits/${encounterId}/call/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to call patient'));
      }
      throw error;
    }
  },

  /**
   * Start consultation (called/checked_in/on_hold -> in_progress)
   */
  startConsultation: async (encounterId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postVisitStartConsultation(
          { id: encounterId },
          { signal: options.signal },
        );
        return adaptV2Visit(response?.data);
      }
      return await apiClient.post(`/encounters/visits/${encounterId}/start_consultation/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to start consultation'));
      }
      throw error;
    }
  },

  /**
   * Put consultation on hold (in_progress -> on_hold)
   */
  hold: async (encounterId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postVisitHold(
          { id: encounterId },
          { signal: options.signal },
        );
        return adaptV2Visit(response?.data);
      }
      return apiClient.post(`/encounters/visits/${encounterId}/hold/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to put visit on hold'));
      }
      throw error;
    }
  },

  /**
   * End consultation (in_progress -> ready_checkout)
   */
  endConsultation: async (encounterId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postVisitReadyCheckout(
          { id: encounterId },
          { signal: options.signal },
        );
        return adaptV2Visit(response?.data);
      }
      return apiClient.post(`/encounters/visits/${encounterId}/end_consultation/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to mark visit ready for checkout'));
      }
      throw error;
    }
  },

  /**
   * Checkout patient (ready_checkout/in_progress -> checked_out)
   * @param {string} encounterId - The encounter UUID
   * @param {boolean} force - Force checkout even if requirements not met (admin only)
   */
  checkout: async (encounterId, force = false, options = {}) => {
    const normalizedOptions = typeof force === 'object' && force !== null ? force : options;
    const shouldForce = typeof force === 'object' && force !== null ? Boolean(force.force) : force;

    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postVisitCheckout(
          { id: encounterId },
          { signal: normalizedOptions.signal },
        );
        return adaptV2Visit(response?.data);
      }
      return await apiClient.post(`/encounters/visits/${encounterId}/checkout/`, { force: shouldForce });
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to checkout patient'));
      }
      throw error;
    }
  },

  /**
   * Mark patient as no-show (waiting/checked_in -> no_show)
   */
  noShow: async (encounterId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postVisitNoShow(
          { id: encounterId },
          { signal: options.signal },
        );
        return adaptV2Visit(response?.data);
      }
      return apiClient.post(`/encounters/visits/${encounterId}/no_show/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to mark patient as no-show'));
      }
      throw error;
    }
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
            active_only: true,
            ...(options.practitioner_user_id ? { practitioner_user_id: options.practitioner_user_id } : {}),
            ...(options.status ? { status: options.status } : {}),
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
        const { cursor } = resolveCursorPage('triage', params);
        const response = await v2Api.getTriageQueue({
          query: {
            limit: normalizeLimit(params),
            cursor,
            status: v2TriageStatusFromUi(params.status),
            acuity: v2TriageAcuityFromUi(params.priority || params.acuity),
            assigned_to_user_id: params.assigned_to_user_id,
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
  create: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postTriage(
          normalizeTriagePayload(data),
          { signal: options.signal || data?.signal },
        );
        return adaptV2TriageEntry(response?.data);
      }
      return await apiClient.post('/encounters/triage/', data);
    } catch (error) {
      rethrowAbortError(error);
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
  triage: async (id, data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postTriageAssessment(
          { id },
          {
            acuity: data?.acuity || data?.priority || null,
            notes: data?.notes || data?.triage_notes || null,
          },
          { signal: options.signal || data?.signal },
        );
        return adaptV2TriageEntry(response?.data);
      }
      return apiClient.post(`/encounters/triage/${id}/triage/`, data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to save triage assessment'));
      }
      throw error;
    }
  },

  /**
   * Assign triaged patient to a clinic
   * @param {string} id - Triage entry UUID
   * @param {Object} data - { clinic_id, appointment_type_id, start_time, practitioner_id? }
   */
  assign: async (id, data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const assignedTo = data.assigned_to_user_id || data.practitioner_id;
        if (!assignedTo) {
          throw unsupportedInRustV2('Rust V2 triage assignment requires a practitioner.');
        }
        const response = await v2Api.postTriageAssign(
          { id },
          { assigned_to_user_id: assignedTo },
          { signal: options.signal || data?.signal },
        );
        return adaptV2TriageEntry(response?.data);
      }
      return await apiClient.post(`/encounters/triage/${id}/assign/`, data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to assign triage entry'));
      }
      throw error;
    }
  },

  /**
   * Cancel triage entry (only if not yet assigned)
   */
  cancel: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postTriageCancel({ id }, { signal: options.signal });
        return adaptV2TriageEntry(response?.data);
      }
      return apiClient.post(`/encounters/triage/${id}/cancel/`);
    } catch (error) {
      rethrowAbortError(error);
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
