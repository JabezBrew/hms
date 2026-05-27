import Pill from 'lucide-react/dist/esm/icons/pill.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import PauseCircle from 'lucide-react/dist/esm/icons/circle-pause.js';
import PlayCircle from 'lucide-react/dist/esm/icons/circle-play.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const FREQUENCY_OPTIONS = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Once Daily' },
  { value: 'bid', label: 'Twice Daily (BID)' },
  { value: 'tid', label: 'Three Times Daily (TID)' },
  { value: 'qid', label: 'Four Times Daily (QID)' },
  { value: 'q4h', label: 'Every 4 Hours' },
  { value: 'q6h', label: 'Every 6 Hours' },
  { value: 'q8h', label: 'Every 8 Hours' },
  { value: 'q12h', label: 'Every 12 Hours' },
  { value: 'qhs', label: 'At Bedtime (QHS)' },
  { value: 'prn', label: 'As Needed (PRN)' },
  { value: 'stat', label: 'Immediately (STAT)' },
  { value: 'weekly', label: 'Weekly' },
];

const ACTION_CONFIG = {
  edit: {
    title: 'Edit Prescription',
    getDescription: (prescription) => `Modify ${prescription?.medication_name || 'prescription'} details`,
    icon: Edit,
    confirmLabel: 'Save Changes',
    confirmVariant: 'default',
  },
  discontinue: {
    title: 'Discontinue Prescription',
    getDescription: (prescription) => `Stop ${prescription?.medication_name || 'this medication'}. This action cannot be undone.`,
    icon: XCircle,
    confirmLabel: 'Discontinue',
    confirmVariant: 'destructive',
  },
  hold: {
    title: 'Hold Prescription',
    getDescription: (prescription) => `Temporarily pause ${prescription?.medication_name || 'this medication'}. It can be resumed later.`,
    icon: PauseCircle,
    confirmLabel: 'Put on Hold',
    confirmVariant: 'default',
  },
  resume: {
    title: 'Resume Prescription',
    getDescription: (prescription) => `Resume ${prescription?.medication_name || 'this medication'}?`,
    icon: PlayCircle,
    confirmLabel: 'Resume',
    confirmVariant: 'default',
  },
  renew: {
    title: 'Renew Prescription',
    getDescription: (prescription) => `Create a new prescription for ${prescription?.medication_name || 'this medication'} with the same details.`,
    icon: RefreshCw,
    confirmLabel: 'Renew',
    confirmVariant: 'default',
  },
};

const getActionConfig = (action) => ACTION_CONFIG[action] || ACTION_CONFIG.edit;

function CurrentMedicationSummary({ prescription, compact = false }) {
  return (
    <div className="p-3 bg-muted/50 rounded-lg border border-border">
      <div className="flex items-center gap-2 mb-1">
        <Pill className="size-4 text-sky-500" />
        <span className="font-medium">{prescription?.medication_name}</span>
      </div>
      {compact ? (
        <span className="text-xs text-muted-foreground font-mono">
          {prescription?.route_display || prescription?.route}
        </span>
      ) : (
        <div className="text-xs text-muted-foreground space-y-1">
          <p><span className="font-mono">Dosage:</span> {prescription?.dosage}</p>
          <p><span className="font-mono">Frequency:</span> {prescription?.frequency_display || prescription?.frequency}</p>
          <p><span className="font-mono">Route:</span> {prescription?.route_display || prescription?.route}</p>
        </div>
      )}
    </div>
  );
}

function EditPrescriptionFields({ prescription, formData, errors, onFieldChange }) {
  return (
    <div className="space-y-4">
      <CurrentMedicationSummary prescription={prescription} compact />

      <div className="space-y-2">
        <Label htmlFor="dosage">Dosage *</Label>
        <Input
          id="dosage"
          value={formData.dosage || ''}
          onChange={(event) => onFieldChange('dosage', event.target.value)}
          placeholder="e.g., 500mg, 10ml"
          className={errors.dosage ? 'border-destructive' : ''}
        />
        {errors.dosage && (
          <p className="text-xs text-destructive">{errors.dosage}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="frequency">Frequency</Label>
        <Select
          value={formData.frequency || 'daily'}
          onValueChange={(value) => onFieldChange('frequency', value)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FREQUENCY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="duration">Duration (days)</Label>
        <Input
          id="duration"
          type="number"
          min="1"
          value={formData.duration_days || ''}
          onChange={(event) => onFieldChange('duration_days', event.target.value)}
          placeholder="Leave empty for ongoing"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="instructions">Special Instructions</Label>
        <Textarea
          id="instructions"
          value={formData.instructions || ''}
          onChange={(event) => onFieldChange('instructions', event.target.value)}
          placeholder="e.g., Take with food"
          rows={2}
        />
      </div>
    </div>
  );
}

function DiscontinuePrescriptionFields({ prescription, formData, errors, onFieldChange }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-destructive/10 rounded-lg border border-destructive/30">
        <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-destructive">This will stop the medication</p>
          <p className="text-muted-foreground mt-1">
            The patient will no longer receive {prescription?.medication_name}.
            This action is logged in the patient's medical record.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="reason">Reason for Discontinuation *</Label>
        <Textarea
          id="reason"
          value={formData.reason || ''}
          onChange={(event) => onFieldChange('reason', event.target.value)}
          placeholder="e.g., Course completed, adverse reaction, patient request..."
          rows={3}
          className={errors.reason ? 'border-destructive' : ''}
        />
        {errors.reason && (
          <p className="text-xs text-destructive">{errors.reason}</p>
        )}
      </div>
    </div>
  );
}

function HoldPrescriptionFields({ formData, onFieldChange }) {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/30">
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Holding a prescription temporarily pauses it. You can resume it later.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="reason">Reason (optional)</Label>
        <Textarea
          id="reason"
          value={formData.reason || ''}
          onChange={(event) => onFieldChange('reason', event.target.value)}
          placeholder="e.g., Pending lab results, pre-operative hold..."
          rows={2}
        />
      </div>
    </div>
  );
}

function ResumePrescriptionFields({ prescription }) {
  return (
    <div className="p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
      <p className="text-sm text-emerald-700 dark:text-emerald-400">
        This will resume <strong>{prescription?.medication_name}</strong> and mark it as active again.
      </p>
    </div>
  );
}

function RenewPrescriptionFields({ prescription, formData, onFieldChange }) {
  return (
    <div className="space-y-4">
      <CurrentMedicationSummary prescription={prescription} />

      <div className="space-y-2">
        <Label htmlFor="duration">New Duration (days)</Label>
        <Input
          id="duration"
          type="number"
          min="1"
          value={formData.duration_days || ''}
          onChange={(event) => onFieldChange('duration_days', event.target.value)}
          placeholder="Same as original if empty"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="instructions">Special Instructions</Label>
        <Textarea
          id="instructions"
          value={formData.instructions || ''}
          onChange={(event) => onFieldChange('instructions', event.target.value)}
          rows={2}
        />
      </div>
    </div>
  );
}

function PrescriptionActionFields({
  action,
  prescription,
  formData,
  errors,
  onFieldChange,
}) {
  switch (action) {
    case 'edit':
      return (
        <EditPrescriptionFields
          prescription={prescription}
          formData={formData}
          errors={errors}
          onFieldChange={onFieldChange}
        />
      );
    case 'discontinue':
      return (
        <DiscontinuePrescriptionFields
          prescription={prescription}
          formData={formData}
          errors={errors}
          onFieldChange={onFieldChange}
        />
      );
    case 'hold':
      return <HoldPrescriptionFields formData={formData} onFieldChange={onFieldChange} />;
    case 'resume':
      return <ResumePrescriptionFields prescription={prescription} />;
    case 'renew':
      return (
        <RenewPrescriptionFields
          prescription={prescription}
          formData={formData}
          onFieldChange={onFieldChange}
        />
      );
    default:
      return null;
  }
}

export function PrescriptionActionDialogFrame({
  open,
  onOpenChange,
  action,
  prescription,
  formData,
  errors,
  isLoading,
  onFieldChange,
  onSubmit,
}) {
  const config = getActionConfig(action);
  const ActionIcon = config.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ActionIcon className={cn(
              'size-5',
              action === 'discontinue' ? 'text-destructive' :
                action === 'hold' ? 'text-amber-500' :
                  action === 'resume' ? 'text-emerald-500' :
                    'text-sky-500',
            )} />
            {config.title}
          </DialogTitle>
          <DialogDescription>{config.getDescription(prescription)}</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <PrescriptionActionFields
            action={action}
            prescription={prescription}
            formData={formData}
            errors={errors}
            onFieldChange={onFieldChange}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant={config.confirmVariant}
            onClick={onSubmit}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Processing…
              </>
            ) : (
              config.confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
