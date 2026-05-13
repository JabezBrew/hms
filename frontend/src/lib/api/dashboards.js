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
    practitioner_name: item.practitioner_display_name || item.practitioner_name || '',
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

function unwrapV2List(response) {
  return Array.isArray(response?.data) ? response.data : [];
}

function humanizeSnake(value) {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function lengthOfStayDays(dateValue) {
  const date = dateValue ? new Date(dateValue) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return 0;
  }
  return Math.max(1, Math.ceil((Date.now() - date.getTime()) / 86_400_000));
}

function adaptV2WardBoardPatient(item = {}) {
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
    alerts_count: 0,
    tasks_count: Number(item.open_nursing_task_count || 0),
    has_critical_alerts: false,
    latest_vitals: null,
    last_round_date: null,
    estimated_discharge: null,
  };
}

function adaptV2NursingAlert(alert = {}) {
  return {
    id: alert.id,
    patient_id: alert.patient_id,
    patient_name: alert.patient_display_name || 'Unknown Patient',
    message: alert.title || 'Clinical alert',
    severity: alert.severity || 'normal',
    status: alert.status,
    created_at: alert.created_at,
  };
}

function adaptV2MedicationAdministration(item = {}) {
  return {
    id: item.id,
    patient_id: item.patient_id,
    patient_name: item.patient_display_name || 'Unknown Patient',
    medication_name: item.medication_name || 'Medication',
    dosage: item.dosage || '',
    route: item.route || '',
    frequency: item.frequency || 'Scheduled',
    scheduled_time: item.scheduled_at,
    status: item.status,
    ward_name: item.ward_name || '',
    bed_number: item.bed_code || '',
  };
}

function adaptV2NursingTask(item = {}) {
  return {
    id: item.id,
    patient_id: item.patient_id,
    patient_name: item.patient_display_name || 'Unknown Patient',
    title: humanizeSnake(item.task_type) || 'Nursing Task',
    description: humanizeSnake(item.status) || 'Pending',
    priority: item.priority || 'normal',
    due_at: item.due_at,
    status: item.status,
  };
}

function attachAlertCounts(patients, alerts) {
  const byPatient = new Map();
  for (const alert of alerts) {
    const current = byPatient.get(alert.patient_id) || { count: 0, critical: false };
    current.count += 1;
    current.critical = current.critical || alert.severity === 'critical';
    byPatient.set(alert.patient_id, current);
  }
  return patients.map((patient) => {
    const stats = byPatient.get(patient.patient_id);
    if (!stats) {
      return patient;
    }
    return {
      ...patient,
      alerts_count: stats.count,
      has_critical_alerts: stats.critical,
    };
  });
}

function adaptV2Discharge(item = {}, wardBoardByAdmission = new Map()) {
  const wardPatient = wardBoardByAdmission.get(item.admission_case_id) || {};
  return {
    id: item.id,
    admission_id: item.admission_case_id,
    patient_id: item.patient_id,
    patient_name: item.patient_display_name || wardPatient.patient_name || 'Unknown Patient',
    mrn: item.patient_code || wardPatient.mrn || '',
    ward_name: wardPatient.ward_name || '',
    bed_number: wardPatient.bed_number || 'Unassigned',
    estimated_discharge: item.discharged_at || item.requested_at,
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
   * Get nurse dashboard data
   * @param {Object} params - Query parameters (ward, etc.)
   * @returns {Promise<Object>} Nurse dashboard data
   */
  getNurseDashboard: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const signal = params.signal;
        const wardId = params.ward && params.ward !== 'all' ? params.ward : null;
        const [wardBoard, alertsResponse, medicationsResponse, tasksResponse] = await Promise.all([
          v2Api.getWardBoard({
            query: {
              ...(wardId ? { ward_id: wardId } : {}),
              limit: 20,
            },
            signal,
          }),
          v2Api.getNursingAlerts({ query: { limit: 20 }, signal }),
          v2Api.getMedicationAdministrations({ query: { limit: 20 }, signal }),
          v2Api.getNursingTasks({ query: { limit: 20 }, signal }),
        ]);
        const alerts = unwrapV2List(alertsResponse).map(adaptV2NursingAlert);
        return {
          urgent: {
            critical_alerts: alerts.filter((alert) => alert.severity === 'critical'),
            overdue_medications: [],
            count: alerts.length,
          },
          shift_patients: attachAlertCounts(
            unwrapV2List(wardBoard).map(adaptV2WardBoardPatient),
            alerts,
          ),
          medications_schedule: unwrapV2List(medicationsResponse).map(adaptV2MedicationAdministration),
          tasks: unwrapV2List(tasksResponse).map(adaptV2NursingTask),
        };
      }
      const endpoint = `/dashboards/nurse/${buildQueryString(params)}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch nurse dashboard'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch nurse dashboard'));
    }
  },

  /**
   * Get inpatient doctor dashboard data
   * @returns {Promise<Object>} Inpatient doctor dashboard data
   */
  getInpatientDashboard: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const signal = params.signal;
        const [wardBoardResponse, dischargesResponse, tasksResponse] = await Promise.all([
          v2Api.getWardBoard({ query: { limit: 20 }, signal }),
          v2Api.getDischarges({ query: { limit: 20 }, signal }),
          v2Api.getNursingTasks({ query: { limit: 20 }, signal }),
        ]);
        const wardPatients = unwrapV2List(wardBoardResponse).map(adaptV2WardBoardPatient);
        const wardBoardByAdmission = new Map(wardPatients.map((patient) => [patient.admission_id, patient]));
        return {
          new_admissions: wardPatients,
          my_patients: wardPatients,
          planned_discharges: unwrapV2List(dischargesResponse).map((discharge) => (
            adaptV2Discharge(discharge, wardBoardByAdmission)
          )),
          pending: {
            results_to_review: 0,
            orders_to_sign: unwrapV2List(tasksResponse).length,
          },
        };
      }
      return await apiClient.get('/dashboards/inpatient/');
    } catch (error) {
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
        const [appointmentsResponse, patientsResponse, billingResponse] = await Promise.all([
          v2Api.getAppointments({ query: { date, limit: 50 }, signal }),
          v2Api.getPatients({ query: { limit: 10, status: 'active' }, signal }),
          v2Api.getBillingDashboardSummary({ signal }),
        ]);
        const appointments = unwrapV2List(appointmentsResponse).map(adaptV2AppointmentForDashboard);
        const checkedInCount = appointments.filter((appointment) => (
          appointment.status === 'checked_in' || appointment.status === 'checked-in'
        )).length;
        return {
          check_in_queue: appointments.filter((appointment) => appointment.status === 'scheduled'),
          recent_registrations: unwrapV2List(patientsResponse).map(adaptV2RecentPatient),
          todays_appointments: appointments,
          stats: {
            todays_appointments_count: appointments.length,
            checked_in_count: checkedInCount,
            pending_payments_count: Number(billingResponse?.data?.open_invoices || 0),
          },
        };
      }
      return await apiClient.get('/dashboards/reception/');
    } catch (error) {
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
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch admin compliance details'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch admin compliance details'));
    }
  },
};
