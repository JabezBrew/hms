import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useCreateVitalSigns } from "@/features/nursing/hooks";
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import {
  VitalsAlerts,
  VitalsFormContent,
  VitalsSlideOverFooter,
  VitalsSlideOverHeader,
} from './AddVitalsSlideOverSections';

const EMPTY_VITALS_FORM = {
  temperature: '',
  heart_rate: '',
  blood_pressure_systolic: '',
  blood_pressure_diastolic: '',
  respiratory_rate: '',
  oxygen_saturation: '',
  pain_level: ''
};

/**
 * AddVitalsSlideOver - Split-screen panel for recording vital signs
 *
 * Features:
 * - Slides in from right without backdrop (timeline remains visible)
 * - Quick vital signs entry with validation
 * - Critical value detection and warnings
 * - Backend API integration via useCreateVitalSigns hook
 */
const AddVitalsSlideOverContent = ({
  onClose,
  patient,
  onVitalsRecorded,
  resolvedPatientId,
  resolvedAdmissionId,
}) => {
  const patientId = resolvedPatientId;
  const admissionCaseId = resolvedAdmissionId;

  // Form state
  const [formData, setFormData] = useState(EMPTY_VITALS_FORM);

  const [errors, setErrors] = useState({});
  const [unconfirmed, setUnconfirmed] = useState(false);

  // API mutation
  const createVitalsMutation = useCreateVitalSigns();
  const captureNotifications = useScopedNotifications([patientId, admissionCaseId]);

  // Check for critical values
  const criticalWarnings = useMemo(() => {
    const warnings = [];

    if (formData.temperature) {
      const temp = Number(formData.temperature);
      if (temp < 36.0) warnings.push('Temperature is LOW (< 36.0°C)');
      if (temp > 39.0) warnings.push('Temperature is HIGH (> 39.0°C)');
    }

    if (formData.heart_rate) {
      const hr = Number(formData.heart_rate);
      if (hr < 50) warnings.push('Heart rate is LOW (< 50 bpm)');
      if (hr > 120) warnings.push('Heart rate is HIGH (> 120 bpm)');
    }

    if (formData.blood_pressure_systolic) {
      const sys = Number(formData.blood_pressure_systolic);
      if (sys < 90) warnings.push('Systolic BP is LOW (< 90 mmHg)');
      if (sys > 180) warnings.push('Systolic BP is HIGH (> 180 mmHg)');
    }

    if (formData.oxygen_saturation) {
      const spo2 = Number(formData.oxygen_saturation);
      if (spo2 < 92) warnings.push('SpO2 is LOW (< 92%)');
    }

    return warnings;
  }, [formData]);

  // Handle input change
  const updateVitalField = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  // Validate form
  const validate = () => {
    const newErrors = {};

    // Check that at least one vital is entered
    const hasAnyVital = Object.values(formData).some(v => v !== '');
    if (!hasAnyVital) {
      newErrors.general = 'Please enter at least one vital sign';
    }

    for (const field of ['heart_rate', 'blood_pressure_systolic', 'blood_pressure_diastolic', 'respiratory_rate', 'oxygen_saturation']) {
      if (formData[field] !== '' && !Number.isInteger(Number(formData[field]))) newErrors[field] = 'Enter a whole number';
    }

    // If BP systolic is entered, diastolic is required (and vice versa)
    if (formData.blood_pressure_systolic && !formData.blood_pressure_diastolic) {
      newErrors.blood_pressure_diastolic = 'Required with systolic';
    }
    if (formData.blood_pressure_diastolic && !formData.blood_pressure_systolic) {
      newErrors.blood_pressure_systolic = 'Required with diastolic';
    }

    // Validate ranges
    if (formData.temperature && (Number(formData.temperature) < 30 || Number(formData.temperature) > 45)) {
      newErrors.temperature = 'Enter a valid temperature (30-45°C)';
    }
    if (formData.heart_rate && (Number(formData.heart_rate) < 20 || Number(formData.heart_rate) > 250)) {
      newErrors.heart_rate = 'Enter a valid heart rate (20-250 bpm)';
    }
    if (formData.oxygen_saturation && (Number(formData.oxygen_saturation) < 50 || Number(formData.oxygen_saturation) > 100)) {
      newErrors.oxygen_saturation = 'Enter a valid SpO2 (50-100%)';
    }
    if (formData.pain_level && (Number(formData.pain_level) < 0 || Number(formData.pain_level) > 10)) {
      newErrors.pain_level = 'Enter a valid pain level (0-10)';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle submit
  const handleSubmit = async () => {
    if (unconfirmed || createVitalsMutation.isPending || !validate()) return;
    const notifications = captureNotifications();

    // Build data object with only non-empty values
    const data = {
      patient: patientId,
      admission_case_id: admissionCaseId,
    };

    if (formData.temperature) data.temperature = Number(formData.temperature);
    if (formData.heart_rate) data.heart_rate = Number(formData.heart_rate);
    if (formData.blood_pressure_systolic) data.blood_pressure_systolic = Number(formData.blood_pressure_systolic);
    if (formData.blood_pressure_diastolic) data.blood_pressure_diastolic = Number(formData.blood_pressure_diastolic);
    if (formData.respiratory_rate) data.respiratory_rate = Number(formData.respiratory_rate);
    if (formData.oxygen_saturation) data.oxygen_saturation = Number(formData.oxygen_saturation);
    if (formData.pain_level) data.pain_level = Number(formData.pain_level);

    try {
      await createVitalsMutation.mutateAsync(data);
      if (!notifications.isCurrent()) return;
      notifications.success('Vital signs recorded');
      onVitalsRecorded?.();
      onClose();
    } catch (err) {
      if (!notifications.isCurrent()) return;
      if (err?.name === 'NursingRecordUnconfirmedError') setUnconfirmed(true);
      setErrors({ general: err.message || 'Vital signs could not be recorded.' });
    }
  };

  // Handle close
  const handleClose = () => {
    if (createVitalsMutation.isPending) return;
    setFormData(EMPTY_VITALS_FORM);
    setErrors({});
    onClose();
  };

  // Get patient display name
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.name || 'Patient';

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col shadow-2xl",
        "translate-x-0"
      )}
    >
      <VitalsSlideOverHeader patientCode={patient?.local_data?.medical_record_number || patient?.local_data?.patient_code || patient?.medical_record_number || patient?.patient_code} patientName={patientName} onClose={handleClose} isPending={createVitalsMutation.isPending} />
      <VitalsAlerts criticalWarnings={criticalWarnings} generalError={errors.general} />
      <VitalsFormContent formData={formData} errors={errors} onChange={updateVitalField} supportsPainLevel={!isRustV2ApiMode()} disabled={unconfirmed || createVitalsMutation.isPending} />
      <VitalsSlideOverFooter
        isPending={createVitalsMutation.isPending}
        isUnconfirmed={unconfirmed}
        onCancel={handleClose}
        onSubmit={handleSubmit}
      />
    </div>
  );
};

const AddVitalsSlideOver = (props) => {
  if (!props.open) return null;
  const patientId = props.patient?.local_data?.id || props.patient?.id;
  const admissionId = props.admissionId
    || props.encounter?.admission_id || props.encounter?.admission?.id
    || props.patient?.local_data?.current_admission_id || props.patient?.current_admission_id || null;
  return <AddVitalsSlideOverContent key={`${patientId}:${admissionId}`} {...props} resolvedPatientId={patientId} resolvedAdmissionId={admissionId} />;
};

export default AddVitalsSlideOver;
export { AddVitalsSlideOver };
