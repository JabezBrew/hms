import { useState, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { useCreateVitalSigns } from "@/features/nursing/hooks";
import { toast } from "sonner";
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
const AddVitalsSlideOver = ({
  open,
  onClose,
  patient,
  encounter,
  onVitalsRecorded
}) => {
  // Get patient ID
  const patientId = patient?.local_data?.id || patient?.id;
  const admissionCaseId = encounter?.admission_id
    || encounter?.admission?.id
    || patient?.local_data?.current_admission_id
    || patient?.current_admission_id
    || null;

  // Form state
  const [formData, setFormData] = useState(EMPTY_VITALS_FORM);

  const [errors, setErrors] = useState({});
  const previousOpenRef = useRef(open);

  // API mutation
  const createVitalsMutation = useCreateVitalSigns();

  if (previousOpenRef.current !== open) {
    previousOpenRef.current = open;
    if (!open) {
      setFormData(EMPTY_VITALS_FORM);
      setErrors({});
    }
  }

  // Check for critical values
  const criticalWarnings = useMemo(() => {
    const warnings = [];

    if (formData.temperature) {
      const temp = parseFloat(formData.temperature);
      if (temp < 36.0) warnings.push('Temperature is LOW (< 36.0°C)');
      if (temp > 39.0) warnings.push('Temperature is HIGH (> 39.0°C)');
    }

    if (formData.heart_rate) {
      const hr = parseInt(formData.heart_rate);
      if (hr < 50) warnings.push('Heart rate is LOW (< 50 bpm)');
      if (hr > 120) warnings.push('Heart rate is HIGH (> 120 bpm)');
    }

    if (formData.blood_pressure_systolic) {
      const sys = parseInt(formData.blood_pressure_systolic);
      if (sys < 90) warnings.push('Systolic BP is LOW (< 90 mmHg)');
      if (sys > 180) warnings.push('Systolic BP is HIGH (> 180 mmHg)');
    }

    if (formData.oxygen_saturation) {
      const spo2 = parseInt(formData.oxygen_saturation);
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

    // If BP systolic is entered, diastolic is required (and vice versa)
    if (formData.blood_pressure_systolic && !formData.blood_pressure_diastolic) {
      newErrors.blood_pressure_diastolic = 'Required with systolic';
    }
    if (formData.blood_pressure_diastolic && !formData.blood_pressure_systolic) {
      newErrors.blood_pressure_systolic = 'Required with diastolic';
    }

    // Validate ranges
    if (formData.temperature && (parseFloat(formData.temperature) < 30 || parseFloat(formData.temperature) > 45)) {
      newErrors.temperature = 'Enter a valid temperature (30-45°C)';
    }
    if (formData.heart_rate && (parseInt(formData.heart_rate) < 20 || parseInt(formData.heart_rate) > 250)) {
      newErrors.heart_rate = 'Enter a valid heart rate (20-250 bpm)';
    }
    if (formData.oxygen_saturation && (parseInt(formData.oxygen_saturation) < 50 || parseInt(formData.oxygen_saturation) > 100)) {
      newErrors.oxygen_saturation = 'Enter a valid SpO2 (50-100%)';
    }
    if (formData.pain_level && (parseInt(formData.pain_level) < 0 || parseInt(formData.pain_level) > 10)) {
      newErrors.pain_level = 'Enter a valid pain level (0-10)';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!validate()) return;

    // Build data object with only non-empty values
    const data = {
      patient: patientId,
      admission_case_id: admissionCaseId,
    };

    if (formData.temperature) data.temperature = parseFloat(formData.temperature);
    if (formData.heart_rate) data.heart_rate = parseInt(formData.heart_rate);
    if (formData.blood_pressure_systolic) data.blood_pressure_systolic = parseInt(formData.blood_pressure_systolic);
    if (formData.blood_pressure_diastolic) data.blood_pressure_diastolic = parseInt(formData.blood_pressure_diastolic);
    if (formData.respiratory_rate) data.respiratory_rate = parseInt(formData.respiratory_rate);
    if (formData.oxygen_saturation) data.oxygen_saturation = parseInt(formData.oxygen_saturation);
    if (formData.pain_level) data.pain_level = parseInt(formData.pain_level);

    try {
      await createVitalsMutation.mutateAsync(data);
      toast.success('Vital signs recorded successfully');
      onVitalsRecorded?.();
      onClose();
    } catch (err) {
      console.error('Failed to record vitals:', err);
      toast.error(err.message || 'Failed to record vital signs');
    }
  };

  // Handle close
  const handleClose = () => {
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
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      <VitalsSlideOverHeader patientName={patientName} onClose={handleClose} />
      <VitalsAlerts criticalWarnings={criticalWarnings} generalError={errors.general} />
      <VitalsFormContent formData={formData} errors={errors} onChange={updateVitalField} />
      <VitalsSlideOverFooter
        isPending={createVitalsMutation.isPending}
        onCancel={handleClose}
        onSubmit={handleSubmit}
      />
    </div>
  );
};

export default AddVitalsSlideOver;
export { AddVitalsSlideOver };
