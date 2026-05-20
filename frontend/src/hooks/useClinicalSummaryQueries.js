import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { fetchChronicleContext } from '@/hooks/useChronicleContext';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';

// Query keys for clinical summary data
const clinicalSummaryKeyFactory = createKeyFactory('clinical-summary');

export const clinicalSummaryKeys = {
  all: clinicalSummaryKeyFactory.all,
  patient: (patientId) => keyWith('clinical-summary', patientId),
  medications: (patientId) => keyWith('clinical-summary', patientId, 'medications'),
  vitals: (patientId) => keyWith('clinical-summary', patientId, 'vitals'),
  problems: (patientId) => keyWith('clinical-summary', patientId, 'problems'),
};

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
 * @deprecated Use useClinicalSummary instead for better performance
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
 * @deprecated Use useClinicalSummary instead for better performance
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

/**
 * Hook to fetch active medications for a patient
 */
export function useActiveMedications(patientId, options = {}) {
  return useQuery({
    queryKey: clinicalSummaryKeys.medications(patientId),
    queryFn: ({ signal }) => fetchActiveMedications(patientId, { signal }),
    enabled: !!patientId && options.enabled !== false,
    staleTime: 60000, // 1 minute
    select: (data) => {
      // Transform prescription data to medication format expected by sidebar
      return data.map(prescription => ({
        id: prescription.id,
        name: prescription.medication_name,
        dose: prescription.dosage,
        route: prescription.route,
        frequency: prescription.frequency,
        status: prescription.status,
        start_date: prescription.start_date,
        end_date: prescription.end_date,
        prescribed_by: prescription.prescribed_by_name,
        instructions: prescription.instructions,
      }));
    },
  });
}

/**
 * Hook to fetch recent vital signs (as lab results proxy)
 */
export function useRecentVitals(patientId, options = {}) {
  const { days = 7 } = options;

  return useQuery({
    queryKey: clinicalSummaryKeys.vitals(patientId),
    queryFn: ({ signal }) => fetchRecentVitals(patientId, days, { signal }),
    enabled: !!patientId && options.enabled !== false,
    staleTime: 30000, // 30 seconds - vitals change frequently
    select: (data) => {
      // Transform vital signs to lab result format for the sidebar
      // Take the most recent entry and extract individual values
      if (!data || data.length === 0) return [];

      const latestVitals = data[data.length - 1]; // Most recent
      const results = [];

      if (latestVitals.temperature) {
        const temp = parseFloat(latestVitals.temperature);
        results.push({
          id: `temp-${latestVitals.id}`,
          name: 'Temp',
          value: latestVitals.temperature,
          unit: '°C',
          timestamp: latestVitals.recorded_at,
          is_abnormal: temp > 38 || temp < 36,
          abnormal_direction: temp > 38 ? 'high' : 'low',
        });
      }

      if (latestVitals.heart_rate) {
        const hr = parseInt(latestVitals.heart_rate);
        results.push({
          id: `hr-${latestVitals.id}`,
          name: 'HR',
          value: latestVitals.heart_rate,
          unit: 'bpm',
          timestamp: latestVitals.recorded_at,
          is_abnormal: hr > 100 || hr < 60,
          abnormal_direction: hr > 100 ? 'high' : 'low',
        });
      }

      if (latestVitals.blood_pressure) {
        const [systolic] = latestVitals.blood_pressure.split('/').map(Number);
        results.push({
          id: `bp-${latestVitals.id}`,
          name: 'BP',
          value: latestVitals.blood_pressure,
          unit: 'mmHg',
          timestamp: latestVitals.recorded_at,
          is_abnormal: systolic > 140 || systolic < 90,
          abnormal_direction: systolic > 140 ? 'high' : 'low',
        });
      }

      if (latestVitals.oxygen_saturation) {
        const spo2 = parseInt(latestVitals.oxygen_saturation);
        results.push({
          id: `spo2-${latestVitals.id}`,
          name: 'SpO2',
          value: latestVitals.oxygen_saturation,
          unit: '%',
          timestamp: latestVitals.recorded_at,
          is_abnormal: spo2 < 95,
          abnormal_direction: 'low',
        });
      }

      if (latestVitals.respiratory_rate) {
        const rr = parseInt(latestVitals.respiratory_rate);
        results.push({
          id: `rr-${latestVitals.id}`,
          name: 'RR',
          value: latestVitals.respiratory_rate,
          unit: '/min',
          timestamp: latestVitals.recorded_at,
          is_abnormal: rr > 20 || rr < 12,
          abnormal_direction: rr > 20 ? 'high' : 'low',
        });
      }

      return results;
    },
  });
}

/**
 * Parse allergies string into array format
 * Handles comma-separated, newline-separated, or JSON format
 */
export function parseAllergies(allergiesData) {
  if (!allergiesData) return [];

  // If already an array, return as-is
  if (Array.isArray(allergiesData)) return allergiesData;

  // If it's a string, try to parse
  if (typeof allergiesData === 'string') {
    const trimmed = allergiesData.trim();

    // Try JSON parse first
    if (trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // Not valid JSON, continue with string parsing
      }
    }

    // Split by common delimiters
    const allergies = trimmed
      .split(/[,;\n]+/)
      .map(a => a.trim())
      .filter(a => a.length > 0);

    return allergies.map(name => ({ name, severity: 'unknown' }));
  }

  return [];
}

/**
 * Combined hook to fetch all clinical summary data
 * Uses a single API call for better performance
 */
export function useClinicalSummary(patientId, patientData = null, options = {}) {
  const { days = 7 } = options;

  // Single query for medications, vitals, and problems
  const summaryQuery = useQuery({
    queryKey: clinicalSummaryKeys.patient(patientId),
    queryFn: ({ signal }) => fetchClinicalSummary(patientId, days, { signal }),
    enabled: !!patientId && options.enabled !== false,
    staleTime: 60000, // 1 minute
    select: (data) => {
      // Transform medications to expected format
      const medications = (data.medications || []).map(prescription => ({
        id: prescription.id,
        name: prescription.medication_name,
        dose: prescription.dosage,
        route: prescription.route,
        frequency: prescription.frequency,
        status: prescription.status,
        start_date: prescription.start_date,
        end_date: prescription.end_date,
        prescribed_by: prescription.prescribed_by_name,
        instructions: prescription.instructions,
      }));

      // Transform vitals to lab results format
      const vitalsData = data.vitals || [];
      const labResults = [];

      if (vitalsData.length > 0) {
        const latestVitals = vitalsData[vitalsData.length - 1];

        if (latestVitals.temperature) {
          const temp = parseFloat(latestVitals.temperature);
          labResults.push({
            id: `temp-${latestVitals.id}`,
            name: 'Temp',
            value: latestVitals.temperature,
            unit: '°C',
            timestamp: latestVitals.recorded_at,
            is_abnormal: temp > 38 || temp < 36,
            abnormal_direction: temp > 38 ? 'high' : 'low',
          });
        }

        if (latestVitals.heart_rate) {
          const hr = parseInt(latestVitals.heart_rate);
          labResults.push({
            id: `hr-${latestVitals.id}`,
            name: 'HR',
            value: latestVitals.heart_rate,
            unit: 'bpm',
            timestamp: latestVitals.recorded_at,
            is_abnormal: hr > 100 || hr < 60,
            abnormal_direction: hr > 100 ? 'high' : 'low',
          });
        }

        if (latestVitals.blood_pressure) {
          const parts = latestVitals.blood_pressure.split('/');
          const systolic = parts.length > 0 ? Number(parts[0]) : null;
          labResults.push({
            id: `bp-${latestVitals.id}`,
            name: 'BP',
            value: latestVitals.blood_pressure,
            unit: 'mmHg',
            timestamp: latestVitals.recorded_at,
            is_abnormal: systolic ? (systolic > 140 || systolic < 90) : false,
            abnormal_direction: systolic > 140 ? 'high' : 'low',
          });
        }

        if (latestVitals.oxygen_saturation) {
          const spo2 = parseInt(latestVitals.oxygen_saturation);
          labResults.push({
            id: `spo2-${latestVitals.id}`,
            name: 'SpO2',
            value: latestVitals.oxygen_saturation,
            unit: '%',
            timestamp: latestVitals.recorded_at,
            is_abnormal: spo2 < 95,
            abnormal_direction: 'low',
          });
        }

        if (latestVitals.respiratory_rate) {
          const rr = parseInt(latestVitals.respiratory_rate);
          labResults.push({
            id: `rr-${latestVitals.id}`,
            name: 'RR',
            value: latestVitals.respiratory_rate,
            unit: '/min',
            timestamp: latestVitals.recorded_at,
            is_abnormal: rr > 20 || rr < 12,
            abnormal_direction: rr > 20 ? 'high' : 'low',
          });
        }
      }

      // Transform problems to expected format
      const problems = (data.problems || []).map(problem => ({
        id: problem.id,
        name: problem.name,
        description: problem.name, // Alias for component compatibility
        severity: problem.severity,
        is_primary: problem.is_primary,
        source: problem.source,
        onset_date: problem.source_date?.split('T')[0], // Extract date part
      }));

      return { medications, labResults, problems };
    },
  });

  // Extract allergies from patient data
  const allergies = patientData?.allergies ? parseAllergies(patientData.allergies) : [];

  return {
    medications: summaryQuery.data?.medications || [],
    medicationsLoading: summaryQuery.isLoading,
    medicationsError: summaryQuery.error,

    labResults: summaryQuery.data?.labResults || [],
    labResultsLoading: summaryQuery.isLoading,
    labResultsError: summaryQuery.error,

    allergies,
    problems: summaryQuery.data?.problems || [],

    isLoading: summaryQuery.isLoading,
    isError: summaryQuery.isError,

    refetch: summaryQuery.refetch,
  };
}

export default useClinicalSummary;
