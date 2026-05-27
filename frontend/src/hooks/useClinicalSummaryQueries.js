import { apiClient } from '@/lib/api-client';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { fetchChronicleContext } from '@/hooks/useChronicleContext';

/**
 * Fetch combined clinical summary (medications + vitals) in a single request
 */
export async function fetchClinicalSummary(patientId, days = 7, options = {}) {
  if (isRustV2ApiMode()) {
    const context = await fetchChronicleContext(patientId, { signal: options.signal });
    return {
      medications: normalizeV2Medications(context?.active_medications),
      vitals: context?.latest_vitals ? [context.latest_vitals] : [],
      problems: normalizeV2Problems(context?.active_problems),
    };
  }

  const response = await apiClient.get(`/clinical-notes/patient-summary/${patientId}/?days=${days}`, {
    signal: options.signal,
  });
  return response || { medications: [], vitals: [] };
}

/**
 * Fetch active medications/prescriptions for a patient
 * @deprecated Prefer the Chronicle context bridge for sidebar data.
 */
export async function fetchActiveMedications(patientId, options = {}) {
  if (isRustV2ApiMode()) {
    const context = await fetchChronicleContext(patientId, { signal: options.signal });
    return normalizeV2Medications(context?.active_medications);
  }

  const response = await apiClient.get(`/clinical-notes/prescriptions/patient_active/?patient=${patientId}`, {
    signal: options.signal,
  });
  return response || [];
}

/**
 * Fetch recent vital signs for a patient (used as proxy for lab results)
 * @deprecated Prefer the Chronicle context bridge for sidebar data.
 */
export async function fetchRecentVitals(patientId, days = 7, options = {}) {
  if (isRustV2ApiMode()) {
    const context = await fetchChronicleContext(patientId, { signal: options.signal });
    return context?.latest_vitals ? [context.latest_vitals] : [];
  }

  const response = await apiClient.get(`/nursing/vital-signs/patient_trends/?patient=${patientId}&days=${days}`, {
    signal: options.signal,
  });
  return response || [];
}

function normalizeV2Medications(medications = []) {
  return Array.isArray(medications)
    ? medications.map((prescription) => ({
        ...prescription,
        dosage: prescription.dosage || prescription.dose,
        start_date: prescription.start_date || prescription.prescribed_at,
        prescribed_by_name: prescription.prescribed_by_name || prescription.prescribed_by,
      }))
    : [];
}

function normalizeV2Problems(problems = []) {
  return Array.isArray(problems)
    ? problems.map((problem) => ({
        ...problem,
        name: problem.name || problem.label,
        source_date: problem.source_date || problem.created_at,
      }))
    : [];
}
