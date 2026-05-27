/* oxlint-disable react-doctor/no-render-in-render -- The form-field helper is a pure switch over action type; extracting it separately would be a larger dialog refactor. */
/* oxlint-disable react-doctor/no-render-in-render -- The form-field helper is a pure switch over action type; extracting it separately would be a larger dialog refactor. */
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import PauseCircle from 'lucide-react/dist/esm/icons/circle-pause.js';
import PlayCircle from 'lucide-react/dist/esm/icons/circle-play.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import { useReducer } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  useUpdatePrescription,
  useDiscontinuePrescription,
  useHoldPrescription,
  useResumePrescription,
  useRenewPrescription,
} from "@/hooks/usePrescriptionMutations";

/**
 * PrescriptionActionsDialog - Unified dialog for prescription lifecycle actions
 *
 * Actions supported:
 * - edit: Modify dosage, frequency, duration, instructions
 * - discontinue: Stop prescription with reason
 * - hold: Temporarily pause prescription
 * - resume: Resume a held prescription
 * - renew: Create new prescription with same details
 */
const getPrescriptionId = (prescription) => prescription?.id || prescription?.data?.id;

const createActionFormData = ({ action, prescription }) => {
  switch (action) {
    case 'edit':
      return {
        dosage: prescription?.dosage || '',
        frequency: prescription?.frequency || 'daily',
        duration_days: prescription?.duration_days || '',
        instructions: prescription?.instructions || '',
        reason: prescription?.reason || '',
      };
    case 'discontinue':
    case 'hold':
      return { reason: '' };
    case 'renew':
      return {
        duration_days: prescription?.duration_days || '',
        instructions: prescription?.instructions || '',
      };
    default:
      return {};
  }
};

const createActionState = (initial) => ({
  formData: createActionFormData(initial),
  errors: {},
});

const withoutFieldError = (errors, field) => {
  if (!errors[field]) {
    return errors;
  }

  const nextErrors = { ...errors };
  delete nextErrors[field];
  return nextErrors;
};

const actionDialogReducer = (state, action) => {
  switch (action.type) {
    case 'fieldChanged':
      return {
        ...state,
        formData: {
          ...state.formData,
          [action.field]: action.value,
        },
        errors: withoutFieldError(state.errors, action.field),
      };
    case 'validationFailed':
      return {
        ...state,
        errors: action.errors,
      };
    default:
      return state;
  }
};

const PrescriptionActionsDialog = (props) => (
  <PrescriptionActionsDialogContent
    key={[
      props.open ? 'open' : 'closed',
      props.action || 'none',
      getPrescriptionId(props.prescription) || 'none',
    ].join(':')}
    {...props}
  />
);

const PrescriptionActionsDialogContent = ({
  open,
  onOpenChange,
  prescription,
  action, // 'edit' | 'discontinue' | 'hold' | 'resume' | 'renew'
  onSuccess,
}) => {
  const [state, dispatch] = useReducer(
    actionDialogReducer,
    { action, prescription },
    createActionState,
  );
  const { formData, errors } = state;

  // Mutations
  const updateMutation = useUpdatePrescription();
  const discontinueMutation = useDiscontinuePrescription();
  const holdMutation = useHoldPrescription();
  const resumeMutation = useResumePrescription();
  const renewMutation = useRenewPrescription();

  // Get the appropriate mutation based on action
  const getMutation = () => {
    switch (action) {
      case 'edit': return updateMutation;
      case 'discontinue': return discontinueMutation;
      case 'hold': return holdMutation;
      case 'resume': return resumeMutation;
      case 'renew': return renewMutation;
      default: return null;
    }
  };

  const mutation = getMutation();
  const isLoading = mutation?.isPending;

  // Action configurations
  const actionConfig = {
    edit: {
      title: 'Edit Prescription',
      description: `Modify ${prescription?.medication_name || 'prescription'} details`,
      icon: Edit,
      confirmLabel: 'Save Changes',
      confirmVariant: 'default',
    },
    discontinue: {
      title: 'Discontinue Prescription',
      description: `Stop ${prescription?.medication_name || 'this medication'}. This action cannot be undone.`,
      icon: XCircle,
      confirmLabel: 'Discontinue',
      confirmVariant: 'destructive',
    },
    hold: {
      title: 'Hold Prescription',
      description: `Temporarily pause ${prescription?.medication_name || 'this medication'}. It can be resumed later.`,
      icon: PauseCircle,
      confirmLabel: 'Put on Hold',
      confirmVariant: 'default',
    },
    resume: {
      title: 'Resume Prescription',
      description: `Resume ${prescription?.medication_name || 'this medication'}?`,
      icon: PlayCircle,
      confirmLabel: 'Resume',
      confirmVariant: 'default',
    },
    renew: {
      title: 'Renew Prescription',
      description: `Create a new prescription for ${prescription?.medication_name || 'this medication'} with the same details.`,
      icon: RefreshCw,
      confirmLabel: 'Renew',
      confirmVariant: 'default',
    },
  };

  const config = actionConfig[action] || actionConfig.edit;
  const ActionIcon = config.icon;

  // Frequency options
  const frequencyOptions = [
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

  // Validate form
  const validate = () => {
    const newErrors = {};

    if (action === 'edit') {
      if (!formData.dosage?.trim()) {
        newErrors.dosage = 'Dosage is required';
      }
    }

    if (action === 'discontinue') {
      if (!formData.reason?.trim()) {
        newErrors.reason = 'Reason is required for discontinuation';
      }
    }

    dispatch({ type: 'validationFailed', errors: newErrors });
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (!validate()) return;

    const prescriptionId = getPrescriptionId(prescription);

    try {
      switch (action) {
        case 'edit':
          await updateMutation.mutateAsync({
            prescriptionId,
            data: {
              dosage: formData.dosage,
              frequency: formData.frequency,
              duration_days: formData.duration_days || null,
              instructions: formData.instructions,
              reason: formData.reason,
            },
          });
          break;

        case 'discontinue':
          await discontinueMutation.mutateAsync({
            prescriptionId,
            reason: formData.reason,
          });
          break;

        case 'hold':
          await holdMutation.mutateAsync({
            prescriptionId,
            reason: formData.reason || '',
          });
          break;

        case 'resume':
          await resumeMutation.mutateAsync({ prescriptionId });
          break;

        case 'renew':
          await renewMutation.mutateAsync({
            prescriptionId,
            duration_days: formData.duration_days || null,
            instructions: formData.instructions,
          });
          break;
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      // Error is handled by the mutation's onError
      console.error('Prescription action failed:', error);
    }
  };

  // Render form fields based on action
  const renderFormFields = () => {
    switch (action) {
      case 'edit':
        return (
          <div className="space-y-4">
            {/* Current medication info */}
            <div className="p-3 bg-muted/50 rounded-lg border border-border">
              <div className="flex items-center gap-2 mb-1">
                <Pill className="size-4 text-sky-500" />
                <span className="font-medium">{prescription?.medication_name}</span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {prescription?.route_display || prescription?.route}
              </span>
            </div>

            {/* Dosage */}
            <div className="space-y-2">
              <Label htmlFor="dosage">Dosage *</Label>
              <Input
                id="dosage"
                value={formData.dosage || ''}
                onChange={(e) => dispatch({
                  type: 'fieldChanged',
                  field: 'dosage',
                  value: e.target.value,
                })}
                placeholder="e.g., 500mg, 10ml"
                className={errors.dosage ? 'border-destructive' : ''}
              />
              {errors.dosage && (
                <p className="text-xs text-destructive">{errors.dosage}</p>
              )}
            </div>

            {/* Frequency */}
            <div className="space-y-2">
              <Label htmlFor="frequency">Frequency</Label>
              <Select
                value={formData.frequency || 'daily'}
                onValueChange={(value) => dispatch({
                  type: 'fieldChanged',
                  field: 'frequency',
                  value,
                })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {frequencyOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Duration */}
            <div className="space-y-2">
              <Label htmlFor="duration">Duration (days)</Label>
              <Input
                id="duration"
                type="number"
                min="1"
                value={formData.duration_days || ''}
                onChange={(e) => dispatch({
                  type: 'fieldChanged',
                  field: 'duration_days',
                  value: e.target.value,
                })}
                placeholder="Leave empty for ongoing"
              />
            </div>

            {/* Instructions */}
            <div className="space-y-2">
              <Label htmlFor="instructions">Special Instructions</Label>
              <Textarea
                id="instructions"
                value={formData.instructions || ''}
                onChange={(e) => dispatch({
                  type: 'fieldChanged',
                  field: 'instructions',
                  value: e.target.value,
                })}
                placeholder="e.g., Take with food"
                rows={2}
              />
            </div>
          </div>
        );

      case 'discontinue':
        return (
          <div className="space-y-4">
            {/* Warning */}
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

            {/* Reason */}
            <div className="space-y-2">
              <Label htmlFor="reason">Reason for Discontinuation *</Label>
              <Textarea
                id="reason"
                value={formData.reason || ''}
                onChange={(e) => dispatch({
                  type: 'fieldChanged',
                  field: 'reason',
                  value: e.target.value,
                })}
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

      case 'hold':
        return (
          <div className="space-y-4">
            {/* Info */}
            <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/30">
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Holding a prescription temporarily pauses it. You can resume it later.
              </p>
            </div>

            {/* Reason (optional) */}
            <div className="space-y-2">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Textarea
                id="reason"
                value={formData.reason || ''}
                onChange={(e) => dispatch({
                  type: 'fieldChanged',
                  field: 'reason',
                  value: e.target.value,
                })}
                placeholder="e.g., Pending lab results, pre-operative hold..."
                rows={2}
              />
            </div>
          </div>
        );

      case 'resume':
        return (
          <div className="p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              This will resume <strong>{prescription?.medication_name}</strong> and mark it as active again.
            </p>
          </div>
        );

      case 'renew':
        return (
          <div className="space-y-4">
            {/* Current prescription info */}
            <div className="p-3 bg-muted/50 rounded-lg border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Pill className="size-4 text-sky-500" />
                <span className="font-medium">{prescription?.medication_name}</span>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p><span className="font-mono">Dosage:</span> {prescription?.dosage}</p>
                <p><span className="font-mono">Frequency:</span> {prescription?.frequency_display || prescription?.frequency}</p>
                <p><span className="font-mono">Route:</span> {prescription?.route_display || prescription?.route}</p>
              </div>
            </div>

            {/* New duration */}
            <div className="space-y-2">
              <Label htmlFor="duration">New Duration (days)</Label>
              <Input
                id="duration"
                type="number"
                min="1"
                value={formData.duration_days || ''}
                onChange={(e) => dispatch({
                  type: 'fieldChanged',
                  field: 'duration_days',
                  value: e.target.value,
                })}
                placeholder="Same as original if empty"
              />
            </div>

            {/* Instructions */}
            <div className="space-y-2">
              <Label htmlFor="instructions">Special Instructions</Label>
              <Textarea
                id="instructions"
                value={formData.instructions || ''}
                onChange={(e) => dispatch({
                  type: 'fieldChanged',
                  field: 'instructions',
                  value: e.target.value,
                })}
                rows={2}
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ActionIcon className={cn(
              "size-5",
              action === 'discontinue' ? "text-destructive" :
              action === 'hold' ? "text-amber-500" :
              action === 'resume' ? "text-emerald-500" :
              "text-sky-500"
            )} />
            {config.title}
          </DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* react-doctor-disable-next-line react-doctor/no-render-in-render -- This is a pure action-specific field switch, not a nested component definition. */}
          {renderFormFields()}
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
            onClick={handleSubmit}
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
};

export default PrescriptionActionsDialog;
