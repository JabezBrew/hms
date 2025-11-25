import { useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Activity, Thermometer, Heart, Wind, Droplets, AlertCircle, Check } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCreateVitalSigns } from "@/hooks/useNursingQueries";
import { toast } from "sonner";

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
  onVitalsRecorded
}) => {
  // Get patient ID
  const patientId = patient?.local_data?.id || patient?.id;

  // Form state
  const [formData, setFormData] = useState({
    temperature: '',
    heart_rate: '',
    blood_pressure_systolic: '',
    blood_pressure_diastolic: '',
    respiratory_rate: '',
    oxygen_saturation: '',
    pain_level: ''
  });

  const [errors, setErrors] = useState({});
  const [criticalWarnings, setCriticalWarnings] = useState([]);

  // API mutation
  const createVitalsMutation = useCreateVitalSigns();

  // Reset form when panel closes
  useEffect(() => {
    if (!open) {
      setFormData({
        temperature: '',
        heart_rate: '',
        blood_pressure_systolic: '',
        blood_pressure_diastolic: '',
        respiratory_rate: '',
        oxygen_saturation: '',
        pain_level: ''
      });
      setErrors({});
      setCriticalWarnings([]);
    }
  }, [open]);

  // Check for critical values
  useEffect(() => {
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

    setCriticalWarnings(warnings);
  }, [formData]);

  // Handle input change
  const handleChange = (field, value) => {
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
      patient: patientId
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
    setFormData({
      temperature: '',
      heart_rate: '',
      blood_pressure_systolic: '',
      blood_pressure_diastolic: '',
      respiratory_rate: '',
      oxygen_saturation: '',
      pain_level: ''
    });
    setErrors({});
    setCriticalWarnings([]);
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
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
            <Activity className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">
              Record Vital Signs
            </h2>
            <p className="font-mono text-xs text-muted-foreground mt-0.5">
              {patientName}
            </p>
          </div>
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={handleClose}
          className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
        >
          <X className="h-4 w-4 mr-1.5" />
          Close
        </Button>
      </header>

      {/* Critical Warnings */}
      {criticalWarnings.length > 0 && (
        <div className="px-6 pt-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <span className="font-semibold">Critical Values Detected:</span>
              <ul className="list-disc list-inside mt-1">
                {criticalWarnings.map((warning, i) => (
                  <li key={i} className="text-sm">{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* General Error */}
      {errors.general && (
        <div className="px-6 pt-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{errors.general}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Temperature */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              <Thermometer className="h-4 w-4" />
              Temperature
            </Label>
            <div className="relative">
              <Input
                type="number"
                step="0.1"
                placeholder="36.5"
                value={formData.temperature}
                onChange={(e) => handleChange('temperature', e.target.value)}
                className={cn(
                  "font-mono pr-12",
                  errors.temperature && "border-red-500"
                )}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">
                °C
              </span>
            </div>
            {errors.temperature && (
              <p className="text-xs text-red-500">{errors.temperature}</p>
            )}
          </div>

          {/* Heart Rate */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              <Heart className="h-4 w-4" />
              Heart Rate
            </Label>
            <div className="relative">
              <Input
                type="number"
                placeholder="72"
                value={formData.heart_rate}
                onChange={(e) => handleChange('heart_rate', e.target.value)}
                className={cn(
                  "font-mono pr-14",
                  errors.heart_rate && "border-red-500"
                )}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">
                bpm
              </span>
            </div>
            {errors.heart_rate && (
              <p className="text-xs text-red-500">{errors.heart_rate}</p>
            )}
          </div>

          {/* Blood Pressure */}
          <div className="space-y-2 md:col-span-2">
            <Label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              <Activity className="h-4 w-4" />
              Blood Pressure
            </Label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  type="number"
                  placeholder="120"
                  value={formData.blood_pressure_systolic}
                  onChange={(e) => handleChange('blood_pressure_systolic', e.target.value)}
                  className={cn(
                    "font-mono",
                    errors.blood_pressure_systolic && "border-red-500"
                  )}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs">
                  sys
                </span>
              </div>
              <span className="text-muted-foreground font-mono">/</span>
              <div className="relative flex-1">
                <Input
                  type="number"
                  placeholder="80"
                  value={formData.blood_pressure_diastolic}
                  onChange={(e) => handleChange('blood_pressure_diastolic', e.target.value)}
                  className={cn(
                    "font-mono",
                    errors.blood_pressure_diastolic && "border-red-500"
                  )}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs">
                  dia
                </span>
              </div>
              <span className="text-muted-foreground font-mono text-sm">mmHg</span>
            </div>
            {(errors.blood_pressure_systolic || errors.blood_pressure_diastolic) && (
              <p className="text-xs text-red-500">
                {errors.blood_pressure_systolic || errors.blood_pressure_diastolic}
              </p>
            )}
          </div>

          {/* Respiratory Rate */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              <Wind className="h-4 w-4" />
              Respiratory Rate
            </Label>
            <div className="relative">
              <Input
                type="number"
                placeholder="16"
                value={formData.respiratory_rate}
                onChange={(e) => handleChange('respiratory_rate', e.target.value)}
                className="font-mono pr-16"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">
                /min
              </span>
            </div>
          </div>

          {/* SpO2 */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              <Droplets className="h-4 w-4" />
              Oxygen Saturation (SpO2)
            </Label>
            <div className="relative">
              <Input
                type="number"
                placeholder="98"
                value={formData.oxygen_saturation}
                onChange={(e) => handleChange('oxygen_saturation', e.target.value)}
                className={cn(
                  "font-mono pr-10",
                  errors.oxygen_saturation && "border-red-500"
                )}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">
                %
              </span>
            </div>
            {errors.oxygen_saturation && (
              <p className="text-xs text-red-500">{errors.oxygen_saturation}</p>
            )}
          </div>

          {/* Pain Level */}
          <div className="space-y-2 md:col-span-2">
            <Label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Pain Level (0-10)
            </Label>
            <div className="flex items-center gap-2">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => handleChange('pain_level', level.toString())}
                  className={cn(
                    "w-9 h-9 rounded-lg font-mono text-sm transition-colors",
                    formData.pain_level === level.toString()
                      ? level <= 3
                        ? "bg-emerald-500 text-white"
                        : level <= 6
                        ? "bg-amber-500 text-white"
                        : "bg-red-500 text-white"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  )}
                >
                  {level}
                </button>
              ))}
            </div>
            {errors.pain_level && (
              <p className="text-xs text-red-500">{errors.pain_level}</p>
            )}
          </div>
        </div>

        {/* Quick Reference */}
        <div className="mt-8 p-4 bg-muted/50 rounded-lg">
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Normal Ranges
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs font-mono">
            <div>
              <span className="text-muted-foreground">Temp:</span> 36.1-37.2°C
            </div>
            <div>
              <span className="text-muted-foreground">HR:</span> 60-100 bpm
            </div>
            <div>
              <span className="text-muted-foreground">BP:</span> 90-120/60-80 mmHg
            </div>
            <div>
              <span className="text-muted-foreground">RR:</span> 12-20 /min
            </div>
            <div>
              <span className="text-muted-foreground">SpO2:</span> 95-100%
            </div>
            <div>
              <span className="text-muted-foreground">Pain:</span> 0 (none)
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-border bg-card">
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClose}
            className="font-mono text-xs"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={createVitalsMutation.isPending}
            className="font-mono text-xs"
          >
            {createVitalsMutation.isPending ? (
              'Recording...'
            ) : (
              <>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Record Vitals
              </>
            )}
          </Button>
        </div>
      </footer>
    </div>
  );
};

export default AddVitalsSlideOver;
export { AddVitalsSlideOver };
