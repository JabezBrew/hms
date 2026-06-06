import { handleV2ApiError } from '@/lib/api/v2/errors';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { v2Api } from '@/lib/api/v2/client';

const EMPTY_MY_WORK = {
  generated_at: null,
  outpatient: {
    date: null,
    appointments: [],
    has_more_appointments: false,
    active_visits: [],
    has_more_active_visits: false,
  },
  inpatient: {
    assigned_wards: [],
    primary_ward_id: null,
    default_ward_id: null,
    can_view_all_wards: false,
  },
  emergency: {
    assigned_triage: [],
    has_more_assigned_triage: false,
    waiting_triage: [],
    has_more_waiting_triage: false,
  },
  patient_context: {
    recent_patients: [],
    has_more_recent_patients: false,
  },
};

function normalizeMyWork(response) {
  const data = response?.data && typeof response.data === 'object' ? response.data : response;
  if (!data || typeof data !== 'object') {
    return EMPTY_MY_WORK;
  }

  return {
    generated_at: data.generated_at || null,
    outpatient: {
      ...EMPTY_MY_WORK.outpatient,
      ...(data.outpatient || {}),
      appointments: Array.isArray(data.outpatient?.appointments) ? data.outpatient.appointments : [],
      active_visits: Array.isArray(data.outpatient?.active_visits) ? data.outpatient.active_visits : [],
    },
    inpatient: {
      ...EMPTY_MY_WORK.inpatient,
      ...(data.inpatient || {}),
      assigned_wards: Array.isArray(data.inpatient?.assigned_wards) ? data.inpatient.assigned_wards : [],
      can_view_all_wards: Boolean(data.inpatient?.can_view_all_wards),
    },
    emergency: {
      ...EMPTY_MY_WORK.emergency,
      ...(data.emergency || {}),
      assigned_triage: Array.isArray(data.emergency?.assigned_triage) ? data.emergency.assigned_triage : [],
      waiting_triage: Array.isArray(data.emergency?.waiting_triage) ? data.emergency.waiting_triage : [],
    },
    patient_context: {
      ...EMPTY_MY_WORK.patient_context,
      ...(data.patient_context || {}),
      recent_patients: Array.isArray(data.patient_context?.recent_patients)
        ? data.patient_context.recent_patients
        : [],
    },
  };
}

export const careAreasApi = {
  getMyWork: async (options = {}) => {
    if (!isRustV2ApiMode()) {
      return EMPTY_MY_WORK;
    }

    try {
      const response = await v2Api.getCareAreaMyWork({ signal: options.signal });
      return normalizeMyWork(response);
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
      throw new Error(handleV2ApiError(error, 'Failed to fetch care-area work'));
    }
  },
};
