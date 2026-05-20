/**
 * useChronicleContext - Hook for fetching patient chronicle context data
 *
 * Returns consolidated patient info, allergies, active problems,
 * active medications, and admission status in a single call.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { handleV2ApiError } from '@/lib/api/v2/errors';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { v2Api } from '@/lib/api/v2/client';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';

// Query keys
const chronicleKeyFactory = createKeyFactory('chronicle');

export const chronicleKeys = {
  all: chronicleKeyFactory.all,
  context: (patientId) => keyWith('chronicle', 'context', patientId),
  timeline: (patientId, filters) => keyWith('chronicle', 'timeline', patientId, filters),
};

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function adaptV2Patient(patient) {
  if (!patient) {
    return patient;
  }
  return {
    ...patient,
    medical_record_number: patient.patient_code,
    mrn: patient.patient_code,
    name: patient.display_name,
    gender: patient.sex,
    registry_status: patient.status,
    local_data: {
      id: patient.id,
      medical_record_number: patient.patient_code,
      first_name: patient.first_name,
      last_name: patient.last_name,
      date_of_birth: patient.date_of_birth,
      gender: patient.sex,
    },
  };
}

function adaptV2Problem(problem) {
  return {
    ...problem,
    name: problem.label,
    title: problem.label,
    is_active: problem.status === 'active',
  };
}

function adaptV2Prescription(prescription) {
  return {
    ...prescription,
    medication: prescription.medication_name,
    medication_display: prescription.medication_name,
    prescribed_date: prescription.prescribed_at,
    is_active: prescription.status === 'active',
  };
}

function adaptV2Allergy(allergy) {
  return {
    ...allergy,
    allergen: allergy.substance,
    is_active: allergy.status === 'active',
  };
}

function adaptV2LatestVitals(chartEntries = []) {
  if (!Array.isArray(chartEntries) || chartEntries.length === 0) {
    return null;
  }

  const latestByType = new Map();
  for (const entry of chartEntries) {
    const existing = latestByType.get(entry.entry_type);
    if (!existing || String(entry.measured_at || '') > String(existing.measured_at || '')) {
      latestByType.set(entry.entry_type, entry);
    }
  }

  const latestEntry = [...latestByType.values()].sort((left, right) =>
    String(right.measured_at || '').localeCompare(String(left.measured_at || ''))
  )[0];

  const vitals = {
    id: latestEntry?.id,
    recorded_at: latestEntry?.measured_at,
  };

  const assign = (entryType, field) => {
    const entry = latestByType.get(entryType);
    if (entry) {
      vitals[field] = entry.value;
    }
  };

  assign('temperature', 'temperature');
  assign('pulse', 'heart_rate');
  assign('respiratory_rate', 'respiratory_rate');
  assign('blood_pressure', 'blood_pressure');
  assign('oxygen_saturation', 'oxygen_saturation');
  assign('weight', 'weight');

  return vitals;
}

function adaptV2ChronicleContext(summary = {}) {
  const problems = Array.isArray(summary.problems) ? summary.problems.map(adaptV2Problem) : [];
  const allergies = Array.isArray(summary.allergies) ? summary.allergies.map(adaptV2Allergy) : [];
  const prescriptions = Array.isArray(summary.prescriptions)
    ? summary.prescriptions.map(adaptV2Prescription)
    : [];
  const activeProblems = problems.filter((problem) => problem.status === 'active');
  const activeMedications = prescriptions.filter((prescription) => prescription.status === 'active');

  return {
    ...summary,
    patient: adaptV2Patient(summary.patient),
    problems,
    allergies,
    prescriptions,
    active_problems: activeProblems,
    active_medications: activeMedications,
    latest_vitals: adaptV2LatestVitals(summary.chart_entries),
    active_encounter: null,
  };
}

export async function fetchChronicleContext(patientId, options = {}) {
  if (isRustV2ApiMode()) {
    try {
      const response = await v2Api.getPatientChronicle({
        id: patientId,
      }, { signal: options.signal });
      return adaptV2ChronicleContext(response?.data ?? {});
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleV2ApiError(error, 'Failed to fetch Chronicle context'));
    }
  }

  const response = await apiClient.get(`/clinical-notes/chronicle/${patientId}/context/`, {
    signal: options.signal,
  });
  const data = response?.data ?? response;
  return data ?? {};
}

/**
 * Fetch patient chronicle context (Tier 1 data)
 *
 * Consolidates:
 * - Patient info (id, mrn, name, age, gender, etc.)
 * - Allergies
 * - Active problems
 * - Active medications
 * - Admission status
 * - Active encounter
 */
export function useChronicleContext(patientId, options = {}) {
  return useQuery({
    queryKey: chronicleKeys.context(patientId),
    queryFn: ({ signal }) => fetchChronicleContext(patientId, { signal }),
    enabled: !!patientId && (options.enabled !== false),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    ...options,
  });
}

/**
 * Fetch patient timeline v2 (Tier 2 data)
 *
 * Uses TimelineEvent for efficient pagination while returning full details.
 *
 * @param {string} patientId - Patient UUID
 * @param {object} filters - Query filters
 * @param {string} filters.type - Filter by type (notes, vitals, prescriptions, labs, referrals, all)
 * @param {string} filters.search - Text search
 * @param {number} filters.page - Page number (default: 1)
 * @param {number} filters.pageSize - Items per page (default: 20)
 * @param {string} filters.startDate - Filter from date (ISO format)
 * @param {string} filters.endDate - Filter until date (ISO format)
 * @param {string} filters.encounterId - Filter by encounter
 */
export function useTimelineV2(patientId, filters = {}, options = {}) {
  const {
    type = 'all',
    search = '',
    page = 1,
    pageSize = 20,
    startDate,
    endDate,
    encounterId,
  } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls
    queryKey: keyWith('chronicle', 'timeline', patientId, type, search, page, pageSize, startDate, endDate, encounterId),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (type && type !== 'all') params.append('type', type);
      if (search) params.append('search', search);
      params.append('page', page.toString());
      params.append('page_size', pageSize.toString());
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (encounterId) params.append('encounter_id', encounterId);

      const response = await apiClient.get(
        `/clinical-notes/chronicle/${patientId}/timeline/?${params.toString()}`
      );
      // apiClient.get returns data directly, not wrapped in response.data
      const data = response?.data ?? response;
      return data ?? { results: [], count: 0 };
    },
    enabled: !!patientId && (options.enabled !== false),
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: false,
    ...options,
  });
}
