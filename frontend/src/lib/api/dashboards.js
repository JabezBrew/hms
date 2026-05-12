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

function extractV2Snapshot(response) {
  return response?.data || {};
}

function metricValue(snapshot, key) {
  const metric = (snapshot.metrics || []).find((candidate) => candidate.key === key);
  return Number(metric?.value || 0);
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
    kpis: {
      active_patients: {
        count: activePatients,
      },
      occupancy: {
        total_beds: 0,
        occupied_beds: 0,
        percent: 0,
      },
      admissions_today: {
        count: 0,
        trend_pct: 0,
      },
      discharges_today: {
        planned: 0,
        completed: 0,
        completion_rate: 0,
      },
      appointment_throughput: {
        scheduled: waitingVisits,
        completed: 0,
        completion_rate: 0,
      },
      staffing_coverage: {
        required_shifts: 0,
        filled_shifts: 0,
        critical_uncovered: 0,
      },
      compliance_risk: {
        total: 0,
        break_glass_pending_review: 0,
        audit_anomalies_24h: 0,
      },
      billing: {
        open_invoices: openInvoices,
      },
    },
    section_summaries: {
      capacity: makeSectionSummary('normal'),
      workforce: makeSectionSummary('normal'),
      compliance: makeSectionSummary('normal'),
    },
    alerts_top: [],
    action_queue_top: [],
    metrics: snapshot.metrics || [],
    navigation: snapshot.navigation || { groups: [] },
    meta: {
      deployment_profile: snapshot.deployment_profile || null,
      generated_at: snapshot.generated_at || null,
      stale: false,
    },
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
    meta: {
      deployment_profile: snapshot.deployment_profile || null,
      generated_at: snapshot.generated_at || null,
    },
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
    start_time: item.starts_at,
    end_time: item.ends_at,
  };
}

function adaptV2AppointmentsToClinicSchedule(response, params = {}) {
  const date = params.date || new Date().toISOString().slice(0, 10);
  const appointments = (response?.data || [])
    .map(adaptV2AppointmentForDashboard)
    .filter((appointment) => !params.date || appointment.start_time?.slice(0, 10) === params.date);
  return {
    date,
    appointments,
    current_patient: appointments.find((appointment) => appointment.status === 'checked_in') || null,
    upcoming: appointments.filter((appointment) => appointment.status === 'scheduled'),
    completed: appointments.filter((appointment) => appointment.status === 'completed'),
  };
}

function adaptV2WardsToCapacity(response) {
  const wards = (response?.data || []).map((ward) => {
    const totalBeds = Number(ward.active_bed_count || 0);
    const occupiedBeds = Number(ward.occupied_bed_count || 0);
    const availableBeds = Math.max(totalBeds - occupiedBeds, 0);
    const occupancyPct = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;
    return {
      ward_id: ward.id,
      ward_name: ward.name,
      total_beds: totalBeds,
      occupied_beds: occupiedBeds,
      available_beds: availableBeds,
      occupancy_pct: occupancyPct,
    };
  });

  return {
    summary: {
      ward_count: wards.length,
      high_occupancy_wards: wards.filter((ward) => Number(ward.occupancy_pct || 0) >= 85).length,
    },
    wait_time: {
      median_minutes: 0,
      p95_minutes: 0,
    },
    wards,
  };
}

function emptyV2WorkforceDetails() {
  return {
    summary: {
      required_shifts: 0,
      filled_shifts: 0,
      next_2h_risks: 0,
    },
    uncovered_shifts: [],
  };
}

function emptyV2ComplianceDetails() {
  return {
    summary: {
      documentation_completeness_pct: 0,
      break_glass_pending_review: 0,
    },
    break_glass_recent: [],
    audit_anomalies_breakdown: [],
  };
}

/**
 * Dashboards API service
 */
export const dashboardsApi = {
  /**
   * Get nurse dashboard data
   * @param {Object} params - Query parameters (ward, etc.)
   * @returns {Promise<Object>} Nurse dashboard data
   */
  getNurseDashboard: async (params = {}) => {
    try {
      const endpoint = `/dashboards/nurse/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch nurse dashboard'));
    }
  },

  /**
   * Get inpatient doctor dashboard data
   * @returns {Promise<Object>} Inpatient doctor dashboard data
   */
  getInpatientDashboard: async () => {
    try {
      return await apiClient.get('/dashboards/inpatient/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch inpatient dashboard'));
    }
  },

  /**
   * Get receptionist dashboard data
   * @returns {Promise<Object>} Receptionist dashboard data
   */
  getReceptionistDashboard: async () => {
    try {
      return await apiClient.get('/dashboards/reception/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch receptionist dashboard'));
    }
  },

  /**
   * Get admin dashboard data
   * @returns {Promise<Object>} Admin dashboard data
   */
  getAdminDashboard: async () => {
    try {
      if (isRustV2ApiMode()) {
        await v2Api.getDashboardSnapshot();
        return adaptV2SnapshotToLegacyAdminMonitor();
      }
      return await apiClient.get('/dashboards/admin/');
    } catch (error) {
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
        return adaptV2SnapshotToMyWork(await v2Api.getDashboardSnapshot(), params);
      }
      const endpoint = `/dashboards/my-work/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
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
        return adaptV2AppointmentsToClinicSchedule(
          await v2Api.getAppointments({ query: { limit: 50 } }),
          params,
        );
      }
      const endpoint = `/dashboards/clinic/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
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
  getAdminDashboardV2: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return adaptV2SnapshotToAdminSummary(await v2Api.getDashboardSnapshot());
      }
      const endpoint = `/dashboards/admin-v2/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
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
  getAdminDashboardV2Capacity: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return adaptV2WardsToCapacity(await v2Api.getWards({ query: { limit: 100 } }));
      }
      const endpoint = `/dashboards/admin-v2/capacity/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
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
  getAdminDashboardV2Workforce: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return emptyV2WorkforceDetails();
      }
      const endpoint = `/dashboards/admin-v2/workforce/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
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
  getAdminDashboardV2Compliance: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return emptyV2ComplianceDetails();
      }
      const endpoint = `/dashboards/admin-v2/compliance/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch admin compliance details'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch admin compliance details'));
    }
  },
};
