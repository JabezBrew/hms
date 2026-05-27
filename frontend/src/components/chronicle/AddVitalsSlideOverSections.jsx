import X from 'lucide-react/dist/esm/icons/x.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Thermometer from 'lucide-react/dist/esm/icons/thermometer.js';
import Heart from 'lucide-react/dist/esm/icons/heart.js';
import Wind from 'lucide-react/dist/esm/icons/wind.js';
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const PAIN_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const NORMAL_RANGES = [
  ['Temp:', '36.1-37.2°C'],
  ['HR:', '60-100 bpm'],
  ['BP:', '90-120/60-80 mmHg'],
  ['RR:', '12-20 /min'],
  ['SpO2:', '95-100%'],
  ['Pain:', '0 (none)'],
];

function VitalNumberField({
  icon: Icon,
  label,
  value,
  error,
  onChange,
  placeholder,
  unit,
  step,
}) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </Label>
      <div className="relative">
        <Input
          type="number"
          step={step}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            unit ? 'font-mono pr-16' : 'font-mono',
            error && 'border-red-500',
          )}
        />
        {unit && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">
            {unit}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function BloodPressureField({ formData, errors, onChange }) {
  const error = errors.blood_pressure_systolic || errors.blood_pressure_diastolic;

  return (
    <div className="space-y-2 md:col-span-2">
      <Label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <Activity className="size-4" />
        Blood Pressure
      </Label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            type="number"
            placeholder="120"
            value={formData.blood_pressure_systolic}
            onChange={(event) => onChange('blood_pressure_systolic', event.target.value)}
            className={cn(
              'font-mono',
              errors.blood_pressure_systolic && 'border-red-500',
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
            onChange={(event) => onChange('blood_pressure_diastolic', event.target.value)}
            className={cn(
              'font-mono',
              errors.blood_pressure_diastolic && 'border-red-500',
            )}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs">
            dia
          </span>
        </div>
        <span className="text-muted-foreground font-mono text-sm">mmHg</span>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function PainScaleField({ value, error, onChange }) {
  return (
    <div className="space-y-2 md:col-span-2">
      <Label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Pain Level (0-10)
      </Label>
      <div className="flex items-center gap-2">
        {PAIN_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => onChange('pain_level', level.toString())}
            className={cn(
              'size-9 rounded-lg font-mono text-sm transition-colors',
              value === level.toString()
                ? level <= 3
                  ? 'bg-emerald-500 text-white'
                  : level <= 6
                    ? 'bg-amber-500 text-white'
                    : 'bg-red-500 text-white'
                : 'bg-muted hover:bg-muted/80 text-muted-foreground',
            )}
          >
            {level}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function VitalsSlideOverHeader({ patientName, onClose }) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
          <Activity className="size-5 text-emerald-600 dark:text-emerald-400" />
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
        onClick={onClose}
        className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
      >
        <X className="size-4 mr-1.5" />
        Close
      </Button>
    </header>
  );
}

export function VitalsAlerts({ criticalWarnings, generalError }) {
  return (
    <>
      {criticalWarnings.length > 0 && (
        <div className="px-6 pt-4">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>
              <span className="font-semibold">Critical Values Detected:</span>
              <ul className="list-disc list-inside mt-1">
                {criticalWarnings.map((warning) => (
                  <li key={warning} className="text-sm">{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {generalError && (
        <div className="px-6 pt-4">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{generalError}</AlertDescription>
          </Alert>
        </div>
      )}
    </>
  );
}

export function VitalsFormContent({ formData, errors, onChange }) {
  return (
    <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <VitalNumberField
          icon={Thermometer}
          label="Temperature"
          value={formData.temperature}
          error={errors.temperature}
          onChange={(value) => onChange('temperature', value)}
          placeholder="36.5"
          step="0.1"
          unit="°C"
        />
        <VitalNumberField
          icon={Heart}
          label="Heart Rate"
          value={formData.heart_rate}
          error={errors.heart_rate}
          onChange={(value) => onChange('heart_rate', value)}
          placeholder="72"
          unit="bpm"
        />
        <BloodPressureField formData={formData} errors={errors} onChange={onChange} />
        <VitalNumberField
          icon={Wind}
          label="Respiratory Rate"
          value={formData.respiratory_rate}
          onChange={(value) => onChange('respiratory_rate', value)}
          placeholder="16"
          unit="/min"
        />
        <VitalNumberField
          icon={Droplets}
          label="Oxygen Saturation (SpO2)"
          value={formData.oxygen_saturation}
          error={errors.oxygen_saturation}
          onChange={(value) => onChange('oxygen_saturation', value)}
          placeholder="98"
          unit="%"
        />
        <PainScaleField value={formData.pain_level} error={errors.pain_level} onChange={onChange} />
      </div>

      <VitalsNormalRanges />
    </div>
  );
}

function VitalsNormalRanges() {
  return (
    <div className="mt-8 p-4 bg-muted/50 rounded-lg">
      <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
        Normal Ranges
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs font-mono">
        {NORMAL_RANGES.map(([label, value]) => (
          <div key={label}>
            <span className="text-muted-foreground">{label}</span> {value}
          </div>
        ))}
      </div>
    </div>
  );
}

export function VitalsSlideOverFooter({ isPending, onCancel, onSubmit }) {
  return (
    <footer className="px-6 py-4 border-t border-border bg-card">
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="font-mono text-xs"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={isPending}
          className="font-mono text-xs"
        >
          {isPending ? (
            'Recording...'
          ) : (
            <>
              <Check className="size-3.5 mr-1.5" />
              Record Vitals
            </>
          )}
        </Button>
      </div>
    </footer>
  );
}
