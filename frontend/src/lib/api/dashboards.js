import { apiClient, handleApiError } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api } from './v2/client';

function buildQueryString(params = {}) {
  const cleanParams = Object.entries(params).reduce((acc, [key, value]) => {
    if (value === undefined || value === null || value === '') {
      return acc;
    }
    acc[key] = String(value);
    return acc;
  }, {});
  const queryString = new URLSearchParams(cleanParams).toString();
  return queryString ? `?${queryString}` : '';
}

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function extractV2Snapshot(response) {
  return response?.data || {};
}

function metricValue(snapshot, key) {
  const metric = (snapshot.metrics || []).find((candidate) => candidate.key === key);
  if (metric?.value === undefined || metric?.value === null || metric.value === '') {
    return null;
  }
  const value = Number(metric.value);
  return Number.isFinite(value) ? value : null;
}

function projectionMeta(response, snapshot = {}) {
  const meta = response?.meta || {};
  const hasGeneratedAt = Object.prototype.hasOwnProperty.call(meta, 'generated_at');
  return {
    deployment_profile: snapshot.deployment_profile || null,
    generated_at: hasGeneratedAt ? meta.generated_at : (snapshot.generated_at ?? null),
    stale: Boolean(meta.is_stale ?? meta.stale ?? false),
    refresh_queued: Boolean(meta.refresh_queued ?? false),
  };
}

function makeSectionSummary(status = 'normal') {
  return {
    status,
    updated_at: null,
  };
}

function adaptV2SnapshotToAdminSummary(response) {
  const snapshot = extractV2Snapshot(response);
  const activePatients = metricValue(snapshot, 'active_patients');
  const waitingVisits = metricValue(snapshot, 'waiting_visits');
  const openInvoices = metricValue(snapshot, 'open_invoices');

  return {
    source: 'rust-v2',
    kpis: {
      active_patients: {
        count: activePatients,
      },
      waiting_visits: {
        count: waitingVisits,
      },
      billing: {
        open_invoices: openInvoices,
      },
    },
    section_summaries: {
      capacity: makeSectionSummary('details'),
      workforce: makeSectionSummary('unavailable'),
      compliance: makeSectionSummary('unavailable'),
    },
    alerts_top: [],
    action_queue_top: [],
    metrics: snapshot.metrics || [],
    navigation: snapshot.navigation || { groups: [] },
    meta: projectionMeta(response, snapshot),
  };
}

function adaptV2SnapshotToLegacyAdminMonitor() {
  return {
    urgent: {
      critical_alerts: [],
      overdue_medications: [],
    },
  };
}

function adaptV2SnapshotToMyWork(response, params = {}) {
  const snapshot = extractV2Snapshot(response);
  return {
    date: params.date || new Date().toISOString().slice(0, 10),
    user_name: null,
    current_patient: null,
    upcoming: [],
    completed: [],
    metrics: snapshot.metrics || [],
    meta: projectionMeta(response, snapshot),
  };
}

function adaptV2AppointmentForDashboard(item = {}) {
  const patientName = item.patient_display_name || item.patient_name || 'Unknown Patient';
  return {
    ...item,
    patient: item.patient_id,
    patient_id: item.patient_id,
    patient_name: patientName,
    patient_display_name: patientName,
    patient_mrn: item.patient_code || '',
    patient_code: item.patient_code || '',
    practitioner_name: item.practitioner_display_name || item.practitioner_name || '',
    start_time: item.starts_at,
    end_time: item.ends_at,
  };
}

function adaptV2AppointmentsToClinicSchedule(response, params = {}) {
  const date = params.date || new Date().toISOString().slice(0, 10);
  const appointments = [];
  for (const item of response?.data || []) {
    const appointment = adaptV2AppointmentForDashboard(item);
    if (!params.date || appointment.start_time?.slice(0, 10) === params.date) {
      appointments.push(appointment);
    }
  }
  return {
    date,
    appointments,
    current_patient: appointments.find((appointment) => appointment.status === 'checked_in') || null,
    upcoming: appointments.filter((appointment) => appointment.status === 'scheduled'),
    completed: appointments.filter((appointment) => appointment.status === 'completed'),
  };
}

function emptyV2WorkforceDetails() {
  return { available: false };
}

function emptyV2ComplianceDetails() {
  return { available: false };
}

function unwrapV2List(response) {
  return Array.isArray(response?.data) ? response.data : [];
}

function optionalCount(value) {
  return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : null;
}

function dashboardSection(result, requestedLimit = null) {
  if (result.status === 'fulfilled' && result.value === null) {
    return {
      response: null,
      meta: {
        status: 'unavailable',
        has_next: null,
        limit: null,
        error: 'This preview is not enabled for this workspace.',
      },
    };
  }
  if (result.status === 'rejected') {
    rethrowAbortError(result.reason);
    return {
      response: null,
      meta: {
        status: 'unavailable',
        has_next: null,
        limit: null,
        error: [403, 404].includes(result.reason?.status)
          ? 'This preview is unavailable with your current access or enabled modules.'
          : 'This preview could not be loaded. Refresh to try again.',
      },
    };
  }
  return {
    response: result.value,
    meta: {
      status: 'available',
      has_next: typeof result.value?.page?.has_next === 'boolean' ? result.value.page.has_next : null,
      limit: optionalCount(result.value?.page?.limit) ?? requestedLimit,
    },
  };
}

function dashboardRequest(sections, key, read) {
  return sections?.[key] === false ? Promise.resolve(null) : read();
}

function lengthOfStayDays(dateValue) {
  const date = dateValue ? new Date(dateValue) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return 0;
  }
  return Math.max(1, Math.ceil((Date.now() - date.getTime()) / 86_400_000));
}

function adaptV2WardBoardPatient(item = {}) {
  const criticalAlerts = optionalCount(item.critical_alert_count);
  return {
    id: item.admission_id,
    admission_id: item.admission_id,
    patient_id: item.patient_id,
    patient_name: item.patient_display_name || 'Unknown Patient',
    mrn: item.patient_code || '',
    diagnosis: '',
    ward_id: item.ward_id,
    ward_name: item.ward_name || '',
    bed_id: item.bed_id || null,
    bed_number: item.bed_code || 'Unassigned',
    admission_date: item.admitted_at,
    length_of_stay: lengthOfStayDays(item.admitted_at),
    alerts_count: optionalCount(item.active_alert_count),
    tasks_count: optionalCount(item.open_nursing_task_count),
    has_critical_alerts: criticalAlerts === null ? null : criticalAlerts > 0,
    active_alert_count: optionalCount(item.active_alert_count),
    critical_alert_count: criticalAlerts,
    unverified_result_count: optionalCount(item.unverified_result_count),
    critical_unverified_result_count: optionalCount(item.critical_unverified_result_count),
    open_nursing_task_count: optionalCount(item.open_nursing_task_count),
    overdue_nursing_task_count: optionalCount(item.overdue_nursing_task_count),
    due_medication_count: optionalCount(item.due_medication_count),
    pending_lab_order_count: optionalCount(item.pending_lab_order_count),
    next_nursing_task_due_at: item.next_nursing_task_due_at || null,
    next_due_medication_at: item.next_due_medication_at || null,
    last_vitals_recorded_at: item.last_vitals_recorded_at || null,
    discharge_status: item.discharge_status || null,
    open_discharge_blocker_count: optionalCount(item.open_discharge_blocker_count),
    latest_vitals: null,
    last_round_date: null,
    estimated_discharge: null,
  };
}

function adaptV2Discharge(item = {}, wardBoardByAdmission = new Map()) {
  const wardPatient = wardBoardByAdmission.get(item.admission_case_id) || {};
  return {
    id: item.id,
    admission_id: item.admission_case_id,
    patient_id: item.patient_id,
    patient_name: item.patient_display_name || wardPatient.patient_name || 'Unknown Patient',
    mrn: item.patient_code || wardPatient.mrn || '',
    ward_id: item.ward_id || wardPatient.ward_id || null,
    ward_name: wardPatient.ward_name || '',
    bed_number: wardPatient.bed_number || 'Unassigned',
    estimated_discharge: item.discharged_at || item.requested_at,
    requested_at: item.requested_at || null,
    discharged_at: item.discharged_at || null,
    length_of_stay: wardPatient.length_of_stay || 0,
    status: item.status,
  };
}

function adaptV2RecentPatient(item = {}) {
  return {
    id: item.id,
    full_name: item.display_name || 'Unknown Patient',
    mrn: item.patient_code || '',
    created_at: item.created_at,
    phone: item.phone || '',
    email: item.email || '',
  };
}

/**
 * Dashboards API service
 */
export const dashboardsApi = {
  /**
   * Get inpatient doctor dashboard data
   * @returns {Promise<Object>} Inpatient doctor dashboard data
   */
  getInpatientDashboard: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const signal = params.signal;
        const results = await Promise.allSettled([
          dashboardRequest(params.sections, 'ward_board', () => v2Api.getWardBoard({ query: { limit: 20 }, signal })),
          dashboardRequest(params.sections, 'discharges', () => v2Api.getDischarges({ query: { limit: 20 }, signal })),
          dashboardRequest(params.sections, 'nursing_tasks', () => v2Api.getNursingTasks({ query: { limit: 20 }, signal })),
        ]);
        const [wardBoard, discharges, tasks] = results.map((result) => dashboardSection(result, 20));
        const wardPatients = unwrapV2List(wardBoard.response).map(adaptV2WardBoardPatient);
        const wardBoardByAdmission = new Map(wardPatients.map((patient) => [patient.admission_id, patient]));
        const resultsToReview = wardBoard.meta.status === 'available'
          && wardPatients.every((patient) => patient.unverified_result_count !== null)
          ? wardPatients.reduce((count, patient) => count + patient.unverified_result_count, 0)
          : null;
        return {
          new_admissions: wardPatients,
          my_patients: wardPatients,
          planned_discharges: unwrapV2List(discharges.response).map((discharge) => (
            adaptV2Discharge(discharge, wardBoardByAdmission)
          )),
          pending: {
            results_to_review: resultsToReview,
            nursing_tasks: tasks.meta.status === 'available' ? unwrapV2List(tasks.response).length : null,
          },
          meta: { sections: { ward_board: wardBoard.meta, discharges: discharges.meta, nursing_tasks: tasks.meta } },
        };
      }
      return await apiClient.get('/dashboards/inpatient/');
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch inpatient dashboard'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch inpatient dashboard'));
    }
  },

  /**
   * Get receptionist dashboard data
   * @returns {Promise<Object>} Receptionist dashboard data
   */
  getReceptionistDashboard: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const date = params.date || new Date().toISOString().slice(0, 10);
        const signal = params.signal;
        const results = await Promise.allSettled([
          dashboardRequest(params.sections, 'appointments', () => v2Api.getAppointments({ query: { date, limit: 50 }, signal })),
          dashboardRequest(params.sections, 'patients', () => v2Api.getPatients({ query: { limit: 10, status: 'active' }, signal })),
          dashboardRequest(params.sections, 'invoices', () => v2Api.getBillingDashboardSummary({ signal })),
        ]);
        const appointmentsSection = dashboardSection(results[0], 50);
        const patientsSection = dashboardSection(results[1], 10);
        const invoicesSection = dashboardSection(results[2]);
        const appointmentsResponse = appointmentsSection.response;
        const patientsResponse = patientsSection.response;
        const billingResponse = invoicesSection.response;
        const appointments = unwrapV2List(appointmentsResponse).map(adaptV2AppointmentForDashboard);
        const checkedInCount = appointments.filter((appointment) => (
          appointment.status === 'checked_in' || appointment.status === 'checked-in'
        )).length;
        return {
          check_in_queue: appointments.filter((appointment) => appointment.status === 'scheduled'),
          recent_registrations: unwrapV2List(patientsResponse).map(adaptV2RecentPatient),
          todays_appointments: appointments,
          stats: {
            todays_appointments_count: appointmentsSection.meta.status === 'available' ? appointments.length : null,
            checked_in_count: appointmentsSection.meta.status === 'available' ? checkedInCount : null,
            pending_payments_count: optionalCount(billingResponse?.data?.open_invoices),
          },
          meta: { date, sections: { appointments: appointmentsSection.meta, patients: patientsSection.meta, invoices: invoicesSection.meta } },
        };
      }
      return await apiClient.get('/dashboards/reception/');
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch receptionist dashboard'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch receptionist dashboard'));
    }
  },

  /**
   * Get admin dashboard data
   * @returns {Promise<Object>} Admin dashboard data
   */
  getAdminDashboard: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        await v2Api.getDashboardSnapshot({ signal: options.signal });
        return adaptV2SnapshotToLegacyAdminMonitor();
      }
      return await apiClient.get('/dashboards/admin/', options);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch admin dashboard'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch admin dashboard'));
    }
  },

  /**
   * Get outpatient doctor dashboard data (my work)
   * @param {Object} params - Query parameters (date, etc.)
   * @returns {Promise<Object>} Outpatient doctor dashboard data
   */
  getMyWorkDashboard: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return adaptV2SnapshotToMyWork(
          await v2Api.getDashboardSnapshot({ signal: params.signal }),
          params,
        );
      }
      const endpoint = `/dashboards/my-work/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch my work dashboard'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch my work dashboard'));
    }
  },

  /**
   * Get clinic schedule dashboard data
   * @param {Object} params - Query parameters (date, practitioner_id, etc.)
   * @returns {Promise<Object>} Clinic schedule data
   */
  getClinicSchedule: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const scheduleDate = params.date || new Date().toISOString().slice(0, 10);
        return adaptV2AppointmentsToClinicSchedule(
          await v2Api.getAppointments({
            query: { date: scheduleDate, limit: 50 },
            signal: params.signal,
          }),
          { ...params, date: scheduleDate },
        );
      }
      const endpoint = `/dashboards/clinic/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch clinic schedule'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch clinic schedule'));
    }
  },

  /**
   * Get admin v2 dashboard summary payload
   * @param {Object} params - Query parameters (window, expand)
   * @returns {Promise<Object>} Admin dashboard v2 summary data
   */
  getAdminDashboardV2: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return adaptV2SnapshotToAdminSummary(
          await v2Api.getDashboardSnapshot({ signal: options.signal }),
        );
      }
      const endpoint = `/dashboards/admin-v2/${buildQueryString(params)}`;
      return await apiClient.get(endpoint, options);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch admin dashboard summary'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch admin dashboard summary'));
    }
  },

  /**
   * Get admin v2 capacity section detail payload
   * @param {Object} params - Query parameters (window)
   * @returns {Promise<Object>} Admin dashboard v2 capacity detail
   */
  getAdminDashboardV2Capacity: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getAdminDashboardV2Capacity({
          query: { limit: 8 },
          signal: options.signal,
        });
        return response?.data || {
          summary: {
            ward_count: 0,
            high_occupancy_wards: 0,
          },
          wait_time: {
            median_minutes: 0,
            p95_minutes: 0,
          },
          wards: [],
        };
      }
      const endpoint = `/dashboards/admin-v2/capacity/${buildQueryString(params)}`;
      return await apiClient.get(endpoint, options);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch admin capacity details'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch admin capacity details'));
    }
  },

  /**
   * Get admin v2 workforce section detail payload
   * @param {Object} params - Query parameters (window)
   * @returns {Promise<Object>} Admin dashboard v2 workforce detail
   */
  getAdminDashboardV2Workforce: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return emptyV2WorkforceDetails();
      }
      const endpoint = `/dashboards/admin-v2/workforce/${buildQueryString(params)}`;
      return await apiClient.get(endpoint, options);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch admin workforce details'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch admin workforce details'));
    }
  },

  /**
   * Get admin v2 compliance section detail payload
   * @param {Object} params - Query parameters (window)
   * @returns {Promise<Object>} Admin dashboard v2 compliance detail
   */
  getAdminDashboardV2Compliance: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return emptyV2ComplianceDetails();
      }
      const endpoint = `/dashboards/admin-v2/compliance/${buildQueryString(params)}`;
      return await apiClient.get(endpoint, options);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch admin compliance details'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch admin compliance details'));
    }
  },
};
