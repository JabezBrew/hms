/**
 * Visits API client for outpatient visit lifecycle and triage queue management.
 */
import { apiClient } from '../api-client';

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
  get: (encounterId) => apiClient.get(`/encounters/visits/${encounterId}/`),

  /**
   * Move patient from checked_in to waiting status
   */
  addToWaiting: (encounterId) =>
    apiClient.post(`/encounters/visits/${encounterId}/add_to_waiting/`),

  /**
   * Call a waiting patient (waiting -> called)
   */
  call: (encounterId) =>
    apiClient.post(`/encounters/visits/${encounterId}/call/`),

  /**
   * Start consultation (called/checked_in/on_hold -> in_progress)
   */
  startConsultation: (encounterId) =>
    apiClient.post(`/encounters/visits/${encounterId}/start_consultation/`),

  /**
   * Put consultation on hold (in_progress -> on_hold)
   */
  hold: (encounterId) =>
    apiClient.post(`/encounters/visits/${encounterId}/hold/`),

  /**
   * End consultation (in_progress -> ready_checkout)
   */
  endConsultation: (encounterId) =>
    apiClient.post(`/encounters/visits/${encounterId}/end_consultation/`),

  /**
   * Checkout patient (ready_checkout/in_progress -> checked_out)
   * @param {string} encounterId - The encounter UUID
   * @param {boolean} force - Force checkout even if requirements not met (admin only)
   */
  checkout: (encounterId, force = false) =>
    apiClient.post(`/encounters/visits/${encounterId}/checkout/`, { force }),

  /**
   * Mark patient as no-show (waiting/checked_in -> no_show)
   */
  noShow: (encounterId) =>
    apiClient.post(`/encounters/visits/${encounterId}/no_show/`),

  /**
   * Get waiting room queue for a clinic
   * Returns list of visits with status waiting or called
   * @param {string} clinicId - The clinic UUID
   */
  waitingRoom: (clinicId) =>
    apiClient.get('/encounters/visits/waiting_room/', { params: { clinic: clinicId } }),
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
  list: (params = {}) => apiClient.get('/encounters/triage/', { params }),

  /**
   * Get single triage entry
   */
  get: (id) => apiClient.get(`/encounters/triage/${id}/`),

  /**
   * Add patient to triage queue
   * @param {Object} data - { patient: uuid, priority: string, chief_complaint: string }
   */
  create: (data) => apiClient.post('/encounters/triage/', data),

  /**
   * Perform triage assessment
   * @param {string} id - Triage entry UUID
   * @param {Object} data - { priority: string, notes: string }
   */
  triage: (id, data) => apiClient.post(`/encounters/triage/${id}/triage/`, data),

  /**
   * Assign triaged patient to a clinic
   * @param {string} id - Triage entry UUID
   * @param {Object} data - { clinic_id, appointment_type_id, start_time, practitioner_id? }
   */
  assign: (id, data) => apiClient.post(`/encounters/triage/${id}/assign/`, data),

  /**
   * Cancel triage entry (only if not yet assigned)
   */
  cancel: (id) => apiClient.post(`/encounters/triage/${id}/cancel/`),
};

export default {
  visits: visitsApi,
  triage: triageApi,
};
