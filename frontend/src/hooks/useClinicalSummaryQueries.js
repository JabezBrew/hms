import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// Query keys for clinical summary data
export const clinicalSummaryKeys = {
  all: ['clinical-summary'],
  patient: (patientId) => [...clinicalSummaryKeys.all, patientId],
  medications: (patientId) => [...clinicalSummaryKeys.patient(patientId), 'medications'],
  vitals: (patientId) => [...clinicalSummaryKeys.patient(patientId), 'vitals'],
  problems: (patientId) => [...clinicalSummaryKeys.patient(patientId), 'problems'],
};

/**
 * Fetch active medications/prescriptions for a patient
 */
async function fetchActiveMedications(patientId) {
  const response = await apiClient.get(`/clinical-notes/prescriptions/patient_active/?patient=${patientId}`);
  return response || [];
}

/**
 * Fetch recent vital signs for a patient (used as proxy for lab results)
 */
async function fetchRecentVitals(patientId, days = 7) {
  const response = await apiClient.get(`/nursing/vital-signs/patient_trends/?patient=${patientId}&days=${days}`);
  return response || [];
}

/**
 * Hook to fetch active medications for a patient
 */
export function useActiveMedications(patientId, options = {}) {
  return useQuery({
    queryKey: clinicalSummaryKeys.medications(patientId),
    queryFn: () => fetchActiveMedications(patientId),
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
    queryFn: () => fetchRecentVitals(patientId, days),
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
 */
export function useClinicalSummary(patientId, patientData = null, options = {}) {
  const medicationsQuery = useActiveMedications(patientId, options);
  const vitalsQuery = useRecentVitals(patientId, options);

  // Extract allergies from patient data
  const allergies = patientData?.allergies ? parseAllergies(patientData.allergies) : [];

  // For problems, we'd need a dedicated endpoint - placeholder for now
  // In a real implementation, this would fetch from a conditions/problems API
  const problems = [];

  return {
    medications: medicationsQuery.data || [],
    medicationsLoading: medicationsQuery.isLoading,
    medicationsError: medicationsQuery.error,

    labResults: vitalsQuery.data || [],
    labResultsLoading: vitalsQuery.isLoading,
    labResultsError: vitalsQuery.error,

    allergies,
    problems,

    isLoading: medicationsQuery.isLoading || vitalsQuery.isLoading,
    isError: medicationsQuery.isError || vitalsQuery.isError,

    refetch: () => {
      medicationsQuery.refetch();
      vitalsQuery.refetch();
    },
  };
}

export default useClinicalSummary;
