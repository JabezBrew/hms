import { useMemo } from "react";

const VITAL_SIDEBAR_FIELDS = [
  {
    keys: ['temperature'],
    name: 'Temp',
    unit: '°C',
    abnormal: (value) => {
      const temp = Number.parseFloat(value);
      if (!Number.isFinite(temp)) return null;
      if (temp > 38) return 'high';
      if (temp < 36) return 'low';
      return null;
    },
  },
  {
    keys: ['heart_rate', 'pulse'],
    name: 'HR',
    unit: 'bpm',
    abnormal: (value) => {
      const heartRate = Number.parseInt(value, 10);
      if (!Number.isFinite(heartRate)) return null;
      if (heartRate > 100) return 'high';
      if (heartRate < 60) return 'low';
      return null;
    },
  },
  {
    keys: ['blood_pressure'],
    name: 'BP',
    unit: 'mmHg',
    abnormal: (value, vitals) => {
      const parts = String(value || '').split('/');
      const systolic = Number.parseInt(vitals?.blood_pressure_systolic ?? parts[0], 10);
      const diastolic = Number.parseInt(vitals?.blood_pressure_diastolic ?? parts[1], 10);
      if (Number.isFinite(systolic) && (systolic > 140 || systolic < 90)) {
        return systolic > 140 ? 'high' : 'low';
      }
      if (Number.isFinite(diastolic) && (diastolic > 90 || diastolic < 60)) {
        return diastolic > 90 ? 'high' : 'low';
      }
      return null;
    },
  },
  {
    keys: ['oxygen_saturation', 'spo2'],
    name: 'SpO2',
    unit: '%',
    abnormal: (value) => {
      const spo2 = Number.parseInt(value, 10);
      if (!Number.isFinite(spo2)) return null;
      return spo2 < 95 ? 'low' : null;
    },
  },
  {
    keys: ['respiratory_rate'],
    name: 'RR',
    unit: '/min',
    abnormal: (value) => {
      const respiratoryRate = Number.parseInt(value, 10);
      if (!Number.isFinite(respiratoryRate)) return null;
      if (respiratoryRate > 20) return 'high';
      if (respiratoryRate < 12) return 'low';
      return null;
    },
  },
  {
    keys: ['pain_level', 'pain_score'],
    name: 'Pain',
    unit: '/10',
    abnormal: (value) => {
      const pain = Number.parseInt(value, 10);
      if (!Number.isFinite(pain)) return null;
      return pain >= 7 ? 'high' : null;
    },
  },
];

function hasDisplayValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function firstDisplayValue(source, keys) {
  for (const key of keys) {
    if (hasDisplayValue(source?.[key])) {
      return source[key];
    }
  }
  return null;
}

function normalizeLatestVitalsForSidebar(latestVitals) {
  if (!latestVitals) {
    return [];
  }

  const timestamp = latestVitals.recorded_at
    || latestVitals.measured_at
    || latestVitals.timestamp
    || latestVitals.created_at
    || null;

  return VITAL_SIDEBAR_FIELDS.flatMap((field) => {
    const value = firstDisplayValue(latestVitals, field.keys);
    if (!hasDisplayValue(value)) {
      return [];
    }

    const abnormalDirection = field.abnormal?.(value, latestVitals) || null;
    return [{
      id: `${field.name}-${latestVitals.id || timestamp || value}`,
      name: field.name,
      value,
      unit: field.unit,
      timestamp,
      is_abnormal: Boolean(abnormalDirection),
      abnormal_direction: abnormalDirection,
    }];
  });
}

function normalizeLabResultsForSidebar(results) {
  if (!Array.isArray(results)) {
    return [];
  }

  return results.reduce((normalizedResults, result) => {
    const normalizedResult = {
      id: result.id,
      name: result.name || result.test_name || result.title || result.order_number || 'Lab result',
      value: result.value ?? result.result_value ?? result.status_display ?? result.status ?? null,
      unit: result.unit || result.result_unit || null,
      timestamp: result.timestamp || result.entered_at || result.completed_at || result.ordered_at || result.created_at || null,
      is_abnormal: result.is_abnormal === true || ['low', 'high', 'abnormal', 'critical_low', 'critical_high'].includes(result.flag),
      abnormal_direction: result.abnormal_direction || result.flag || null,
    };
    if (hasDisplayValue(normalizedResult.name) || hasDisplayValue(normalizedResult.value)) {
      normalizedResults.push(normalizedResult);
    }
    return normalizedResults;
  }, []);
}

export function useChronicleSidebarData({ chronicleContext, patient }) {
  const copilotPatientName = useMemo(() => {
    const details = patient?.local_data || patient;
    if (!details) return 'Patient';

    const userDetails = details.user_details;
    if (!userDetails) {
      return details.name || 'Patient';
    }

    const fullName = `${userDetails.first_name || ''} ${userDetails.last_name || ''}`.trim();
    return fullName || details.name || 'Patient';
  }, [patient]);
  const medications = useMemo(
    () => chronicleContext?.active_medications || chronicleContext?.summaries?.medications || [],
    [chronicleContext?.active_medications, chronicleContext?.summaries?.medications],
  );
  const latestVitals = chronicleContext?.latest_vitals;
  const recentVitals = useMemo(() => (
    normalizeLatestVitalsForSidebar(latestVitals)
  ), [latestVitals]);
  const labResults = useMemo(() => {
    const shapedLabs = chronicleContext?.lab_results || chronicleContext?.summaries?.labs || [];
    return normalizeLabResultsForSidebar(shapedLabs);
  }, [chronicleContext?.lab_results, chronicleContext?.summaries?.labs]);

  return {
    allergies: chronicleContext?.allergies || chronicleContext?.summaries?.allergies || [],
    copilotPatientName,
    labResults,
    latestVitals,
    medications,
    problemSummaries: chronicleContext?.problems || chronicleContext?.summaries?.problems || [],
    recentVitals,
  };
}
