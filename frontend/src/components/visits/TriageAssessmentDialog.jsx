import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useTriageActions } from '@/hooks/useVisitQueries';
import { useCreateChartEntries } from '@/hooks/useChartQueries';
import { toast } from 'sonner';

const optionalNumericField = z.string().trim().optional().refine(
  (value) => value === undefined || value === '' || Number.isFinite(Number(value)),
  'Enter a number'
);

const triageSchema = z.object({
  priority: z.enum(['emergency', 'urgent', 'routine']),
  temperature: optionalNumericField,
  pulse: optionalNumericField,
  respiratory_rate: optionalNumericField,
  systolic: optionalNumericField,
  diastolic: optionalNumericField,
  oxygen_saturation: optionalNumericField,
  weight: optionalNumericField,
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  const hasSystolic = Boolean(data.systolic);
  const hasDiastolic = Boolean(data.diastolic);
  if (hasSystolic !== hasDiastolic) {
    const path = hasSystolic ? ['diastolic'] : ['systolic'];
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: 'Enter both blood pressure values',
    });
  }
});

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function getEntryPatientId(entry) {
  if (!entry) return null;
  if (entry.patient_id) return entry.patient_id;
  if (typeof entry.patient === 'object') return entry.patient?.id || entry.patient?.uuid || null;
  return entry.patient || null;
}

function getEntryEncounterId(entry) {
  if (!entry) return null;
  if (entry.encounter_id) return entry.encounter_id;
  if (typeof entry.encounter === 'object') return entry.encounter?.id || entry.encounter?.uuid || null;
  return entry.encounter || null;
}

function getEntryVisitId(entry) {
  if (!entry) return null;
  if (entry.visit_id) return entry.visit_id;
  if (typeof entry.visit === 'object') return entry.visit?.id || entry.visit?.uuid || null;
  return entry.visit || null;
}

function addVitalEntry(entries, data, field, entryType, unit, patientId, measuredAt, context) {
  if (!hasValue(data[field])) return;
  entries.push({
    patient_id: patientId,
    ...context,
    entry_type: entryType,
    measured_at: measuredAt,
    value: String(data[field]).trim(),
    unit,
  });
}

function buildVitalChartEntries(data, patientId, context = {}) {
  const measuredAt = new Date().toISOString();
  const entries = [];
  const chartContext = {
    ...(context.encounterId ? { encounter_id: context.encounterId } : {}),
    ...(context.visitId ? { visit_id: context.visitId } : {}),
  };

  addVitalEntry(entries, data, 'temperature', 'temperature', 'C', patientId, measuredAt, chartContext);
  addVitalEntry(entries, data, 'pulse', 'pulse', 'bpm', patientId, measuredAt, chartContext);
  addVitalEntry(entries, data, 'respiratory_rate', 'respiratory_rate', '/min', patientId, measuredAt, chartContext);
  addVitalEntry(entries, data, 'oxygen_saturation', 'oxygen_saturation', '%', patientId, measuredAt, chartContext);
  addVitalEntry(entries, data, 'weight', 'weight', 'kg', patientId, measuredAt, chartContext);

  if (hasValue(data.systolic) && hasValue(data.diastolic)) {
    entries.push({
      patient_id: patientId,
      ...chartContext,
      entry_type: 'blood_pressure',
      measured_at: measuredAt,
      value: `${String(data.systolic).trim()}/${String(data.diastolic).trim()}`,
      unit: 'mmHg',
    });
  }

  return entries;
}

/**
 * TriageAssessmentDialog - Dialog for performing triage assessment
 *
 * @param {Object} props
 * @param {boolean} props.open - Whether dialog is open
 * @param {Function} props.onClose - Close handler
 * @param {Object} props.entry - Triage queue entry
 * @param {Function} props.onSuccess - Success callback
 */
export function TriageAssessmentDialog({ open, onClose, entry, onSuccess }) {
  if (!entry) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <TriageAssessmentForm
        key={`${entry.id}:${open ? 'open' : 'closed'}`}
        entry={entry}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    </Dialog>
  );
}

function TriageAssessmentForm({ entry, onClose, onSuccess }) {
  const { triagePatient } = useTriageActions();
  const createChartEntries = useCreateChartEntries();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(triageSchema),
    defaultValues: {
      priority: entry?.priority || 'routine',
      temperature: '',
      pulse: '',
      respiratory_rate: '',
      systolic: '',
      diastolic: '',
      oxygen_saturation: '',
      weight: '',
      notes: '',
    },
  });

  const priority = watch('priority');

  const onSubmit = async (data) => {
    const patientId = getEntryPatientId(entry);
    const vitalEntries = patientId
      ? buildVitalChartEntries(data, patientId, {
          encounterId: getEntryEncounterId(entry),
          visitId: getEntryVisitId(entry),
        })
      : [];

    if (!patientId && [
      data.temperature,
      data.pulse,
      data.respiratory_rate,
      data.systolic,
      data.diastolic,
      data.oxygen_saturation,
      data.weight,
    ].some(hasValue)) {
      toast.error('Patient context is required before vitals can be recorded');
      return;
    }

    try {
      await triagePatient.mutateAsync({
        id: entry.id,
        priority: data.priority,
        notes: data.notes || '',
      });

      if (vitalEntries.length > 0) {
        try {
          await createChartEntries.mutateAsync(vitalEntries);
          toast.success('Vitals recorded in Chronicle');
        } catch {
          toast.error('Triage saved, but vitals could not be recorded in Chronicle');
        }
      }

      reset();
      onSuccess?.();
    } catch {
      // useTriageActions owns the user-facing error toast.
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="font-display text-xl">
          Triage Assessment
        </DialogTitle>
      </DialogHeader>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Patient Info */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="font-heading font-semibold mb-1">
            {entry.patient_name}
          </h4>
          {entry.chief_complaint && (
            <p className="text-sm text-muted-foreground">
              Chief complaint: {entry.chief_complaint}
            </p>
          )}
        </div>

        {/* Priority Selection */}
        <div className="space-y-3">
          <Label>Priority Level</Label>
          <RadioGroup
            value={priority}
            onValueChange={(value) => setValue('priority', value)}
            className="grid grid-cols-3 gap-3"
          >
            <div>
              <RadioGroupItem
                value="emergency"
                id="emergency"
                className="peer sr-only"
              />
              <Label
                htmlFor="emergency"
                className="flex flex-col items-center justify-center rounded-lg border-2 border-border bg-card p-4 cursor-pointer hover:bg-accent peer-data-[state=checked]:border-rose-500 peer-data-[state=checked]:bg-rose-500/10"
              >
                <AlertTriangle className="size-6 text-rose-400 mb-2" />
                <span className="text-sm font-medium text-rose-400">
                  Emergency
                </span>
              </Label>
            </div>
            <div>
              <RadioGroupItem
                value="urgent"
                id="urgent"
                className="peer sr-only"
              />
              <Label
                htmlFor="urgent"
                className="flex flex-col items-center justify-center rounded-lg border-2 border-border bg-card p-4 cursor-pointer hover:bg-accent peer-data-[state=checked]:border-amber-500 peer-data-[state=checked]:bg-amber-500/10"
              >
                <AlertCircle className="size-6 text-amber-400 mb-2" />
                <span className="text-sm font-medium text-amber-400">
                  Urgent
                </span>
              </Label>
            </div>
            <div>
              <RadioGroupItem
                value="routine"
                id="routine"
                className="peer sr-only"
              />
              <Label
                htmlFor="routine"
                className="flex flex-col items-center justify-center rounded-lg border-2 border-border bg-card p-4 cursor-pointer hover:bg-accent peer-data-[state=checked]:border-sky-500 peer-data-[state=checked]:bg-sky-500/10"
              >
                <Clock className="size-6 text-sky-400 mb-2" />
                <span className="text-sm font-medium text-sky-400">
                  Routine
                </span>
              </Label>
            </div>
          </RadioGroup>
          {errors.priority && (
            <p className="text-sm text-rose-400">{errors.priority.message}</p>
          )}
        </div>

        <div className="space-y-3">
          <Label>Vitals</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="temperature" className="text-xs text-muted-foreground">Temperature (C)</Label>
              <Input id="temperature" type="number" step="0.1" inputMode="decimal" {...register('temperature')} />
              {errors.temperature && <p className="text-xs text-rose-400">{errors.temperature.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pulse" className="text-xs text-muted-foreground">Pulse (bpm)</Label>
              <Input id="pulse" type="number" inputMode="numeric" {...register('pulse')} />
              {errors.pulse && <p className="text-xs text-rose-400">{errors.pulse.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="respiratory_rate" className="text-xs text-muted-foreground">Respiratory Rate (/min)</Label>
              <Input id="respiratory_rate" type="number" inputMode="numeric" {...register('respiratory_rate')} />
              {errors.respiratory_rate && <p className="text-xs text-rose-400">{errors.respiratory_rate.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oxygen_saturation" className="text-xs text-muted-foreground">Oxygen Saturation (%)</Label>
              <Input id="oxygen_saturation" type="number" inputMode="numeric" {...register('oxygen_saturation')} />
              {errors.oxygen_saturation && <p className="text-xs text-rose-400">{errors.oxygen_saturation.message}</p>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="systolic" className="text-xs text-muted-foreground">Systolic</Label>
                <Input id="systolic" type="number" inputMode="numeric" {...register('systolic')} />
                {errors.systolic && <p className="text-xs text-rose-400">{errors.systolic.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="diastolic" className="text-xs text-muted-foreground">Diastolic</Label>
                <Input id="diastolic" type="number" inputMode="numeric" {...register('diastolic')} />
                {errors.diastolic && <p className="text-xs text-rose-400">{errors.diastolic.message}</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weight" className="text-xs text-muted-foreground">Weight (kg)</Label>
              <Input id="weight" type="number" step="0.1" inputMode="decimal" {...register('weight')} />
              {errors.weight && <p className="text-xs text-rose-400">{errors.weight.message}</p>}
            </div>
          </div>
        </div>

        {/* Triage Notes */}
        <div className="space-y-2">
          <Label htmlFor="notes">Triage Notes</Label>
          <Textarea
            id="notes"
            {...register('notes')}
            placeholder="Enter assessment notes, vital signs, observations..."
            rows={4}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={triagePatient.isPending || createChartEntries.isPending}>
            {triagePatient.isPending || createChartEntries.isPending ? 'Saving...' : 'Save Assessment'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
