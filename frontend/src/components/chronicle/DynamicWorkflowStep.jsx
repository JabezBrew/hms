import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Thermometer from 'lucide-react/dist/esm/icons/thermometer.js';
import Heart from 'lucide-react/dist/esm/icons/heart.js';
import Wind from 'lucide-react/dist/esm/icons/wind.js';
import Gauge from 'lucide-react/dist/esm/icons/gauge.js';
import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const DEFAULT_EMPTY_OBJECT = {};

/**
 * VitalsInput - Grid of vital signs inputs
 */
const VitalsInput = ({ value = DEFAULT_EMPTY_OBJECT, onChange }) => {
  const updateVitalField = (field, val) => {
    onChange({ ...value, [field]: val });
  };

  const vitals = [
    { key: 'temperature', label: 'Temperature', unit: '°C', icon: Thermometer, placeholder: '36.5' },
    { key: 'heart_rate', label: 'Heart Rate', unit: 'bpm', icon: Heart, placeholder: '72' },
    { key: 'blood_pressure_systolic', label: 'BP Systolic', unit: 'mmHg', icon: Gauge, placeholder: '120' },
    { key: 'blood_pressure_diastolic', label: 'BP Diastolic', unit: 'mmHg', icon: Gauge, placeholder: '80' },
    { key: 'respiratory_rate', label: 'Resp. Rate', unit: '/min', icon: Wind, placeholder: '16' },
    { key: 'spo2', label: 'SpO₂', unit: '%', icon: Activity, placeholder: '98' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {vitals.map((vital) => {
        const Icon = vital.icon;
        return (
          <div key={vital.key} className="space-y-1.5">
            <Label className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <Icon className="size-3.5" />
              {vital.label}
            </Label>
            <div className="relative">
              <Input
                type="number"
                step="0.1"
                value={value[vital.key] || ''}
                onChange={(e) => updateVitalField(vital.key, e.target.value)}
                placeholder={vital.placeholder}
                className="pr-12 font-mono text-sm"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
                {vital.unit}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * SubsectionInput - Renders subsections as individual text areas
 */
const SubsectionInput = ({ subsections, value = DEFAULT_EMPTY_OBJECT, onChange }) => {
  const updateSubsectionValue = (key, val) => {
    onChange({ ...value, [key]: val });
  };

  return (
    <div className="space-y-4">
      {subsections.map((subsection) => {
        const key = subsection.name?.toLowerCase().replace(/\s+/g, '_') || subsection.name;
        return (
          <div key={key} className="space-y-1.5">
            <Label className="font-mono text-xs">
              {subsection.name}
              {subsection.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {subsection.type === 'observation' && subsection.observationType === 'vitals' ? (
              <VitalsInput
                value={value[key] || {}}
                onChange={(val) => updateSubsectionValue(key, val)}
              />
            ) : (
              <Textarea
                value={value[key] || ''}
                onChange={(e) => updateSubsectionValue(key, e.target.value)}
                placeholder={subsection.helpText || `Enter ${subsection.name.toLowerCase()}...`}
                className="min-h-[80px] font-mono text-sm resize-none"
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

/**
 * DynamicWorkflowStep - Renders form fields based on template section configuration
 *
 * Handles different section types:
 * - text: Simple textarea
 * - structured: Multiple subsections
 * - observation: Vital signs grid or other observation types
 * - condition: Diagnosis/condition input
 * - medication_administration: Medication input
 * - custom: Custom field types
 */
const DynamicWorkflowStep = ({
  stepConfig,
  formData,
  onDataChange,
  patient,
  template,
}) => {
  const applyStepDataChange = useCallback((value) => {
    onDataChange(value);
  }, [onDataChange]);

  const handleFieldChange = useCallback((field, value) => {
    onDataChange({ ...formData, [field]: value });
  }, [formData, onDataChange]);

  // Get icon for section type
  const getSectionIcon = () => {
    switch (stepConfig.type) {
      case 'observation':
        return <Activity className="size-5" />;
      case 'condition':
        return <Stethoscope className="size-5" />;
      case 'medication_administration':
        return <Pill className="size-5" />;
      default:
        return <FileText className="size-5" />;
    }
  };

  // Render content based on section type
  const renderContent = () => {
    const { type, subsections, observationType, helpText, placeholder } = stepConfig;

    // Structured type with subsections
    if (type === 'structured' && subsections?.length > 0) {
      return (
        <SubsectionInput
          subsections={subsections}
          value={formData}
          onChange={applyStepDataChange}
        />
      );
    }

    // Observation types
    if (type === 'observation') {
      if (observationType === 'vitals') {
        return (
          <VitalsInput
            value={formData}
            onChange={applyStepDataChange}
          />
        );
      }

      // Other observation types (allergy, fluid_balance, etc.)
      return (
        <Textarea
          value={formData.notes || ''}
          onChange={(e) => handleFieldChange('notes', e.target.value)}
          placeholder={helpText || `Enter ${observationType || 'observation'} details...`}
          className="min-h-[150px] font-mono text-sm resize-none"
        />
      );
    }

    // Condition type
    if (type === 'condition') {
      return (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="font-mono text-xs">
              Diagnosis / Condition
              {stepConfig.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Textarea
              value={formData.diagnosis || ''}
              onChange={(e) => handleFieldChange('diagnosis', e.target.value)}
              placeholder="Enter primary diagnosis..."
              className="min-h-[80px] font-mono text-sm resize-none"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="font-mono text-xs">Clinical Notes</Label>
            <Textarea
              value={formData.notes || ''}
              onChange={(e) => handleFieldChange('notes', e.target.value)}
              placeholder="Additional clinical notes..."
              className="min-h-[80px] font-mono text-sm resize-none"
            />
          </div>
        </div>
      );
    }

    // Medication administration type
    if (type === 'medication_administration') {
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="font-mono text-xs">Medication Name</Label>
              <Input
                value={formData.medication || ''}
                onChange={(e) => handleFieldChange('medication', e.target.value)}
                placeholder="Enter medication name"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="font-mono text-xs">Dosage</Label>
              <Input
                value={formData.dosage || ''}
                onChange={(e) => handleFieldChange('dosage', e.target.value)}
                placeholder="e.g., 500mg"
                className="font-mono text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="font-mono text-xs">Route</Label>
              <Input
                value={formData.route || ''}
                onChange={(e) => handleFieldChange('route', e.target.value)}
                placeholder="e.g., Oral, IV"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="font-mono text-xs">Frequency</Label>
              <Input
                value={formData.frequency || ''}
                onChange={(e) => handleFieldChange('frequency', e.target.value)}
                placeholder="e.g., TID, QID"
                className="font-mono text-sm"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="font-mono text-xs">Notes</Label>
            <Textarea
              value={formData.notes || ''}
              onChange={(e) => handleFieldChange('notes', e.target.value)}
              placeholder="Administration notes..."
              className="min-h-[60px] font-mono text-sm resize-none"
            />
          </div>
        </div>
      );
    }

    // Default: text type (simple textarea)
    return (
      <Textarea
        value={typeof formData === 'string' ? formData : (formData.content || '')}
        onChange={(e) => {
          // Handle both string and object form data
          if (typeof formData === 'string' || Object.keys(formData).length === 0) {
            applyStepDataChange(e.target.value);
          } else {
            handleFieldChange('content', e.target.value);
          }
        }}
        placeholder={placeholder || helpText || `Enter ${stepConfig.title.toLowerCase()}...`}
        className="min-h-[200px] font-mono text-sm resize-none"
      />
    );
  };

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div className="flex items-start gap-4">
        <div className="size-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
          {getSectionIcon()}
        </div>
        <div className="flex-1">
          <h3 className="font-display text-2xl text-foreground">
            {stepConfig.title}
          </h3>
          {stepConfig.helpText && (
            <p className="font-mono text-sm text-muted-foreground mt-1">
              {stepConfig.helpText}
            </p>
          )}
          {stepConfig.required && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-amber-600 dark:text-amber-400 mt-2">
              <AlertCircle className="size-3" />
              Required
            </span>
          )}
        </div>
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="pt-6">
          {renderContent()}
        </CardContent>
      </Card>

      {/* Patient Context (if needed) */}
      {patient && stepConfig.showPatientContext && (
        <Card className="bg-muted/30">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Patient Context
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-sm text-foreground">
              {patient.name || 'Unknown Patient'}
            </p>
            {patient.local_data?.allergies && (
              <p className="font-mono text-xs text-red-500 mt-1">
                Allergies: {patient.local_data.allergies}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default DynamicWorkflowStep;
export { DynamicWorkflowStep };
