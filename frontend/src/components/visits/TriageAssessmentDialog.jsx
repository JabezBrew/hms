import React from 'react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useTriageActions } from '@/hooks/useVisitQueries';
import { AlertTriangle, AlertCircle, Clock } from 'lucide-react';

const triageSchema = z.object({
  priority: z.enum(['emergency', 'urgent', 'routine']),
  notes: z.string().optional(),
});

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
  const { triagePatient } = useTriageActions();

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
      notes: '',
    },
  });

  const priority = watch('priority');

  React.useEffect(() => {
    if (entry) {
      reset({
        priority: entry.priority || 'routine',
        notes: '',
      });
    }
  }, [entry, reset]);

  const onSubmit = async (data) => {
    if (!entry) return;

    triagePatient.mutate(
      {
        id: entry.id,
        priority: data.priority,
        notes: data.notes || '',
      },
      {
        onSuccess: () => {
          reset();
          onSuccess?.();
        },
      }
    );
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  if (!entry) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
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
                  <AlertTriangle className="h-6 w-6 text-rose-400 mb-2" />
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
                  <AlertCircle className="h-6 w-6 text-amber-400 mb-2" />
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
                  <Clock className="h-6 w-6 text-sky-400 mb-2" />
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
            <Button type="submit" disabled={triagePatient.isPending}>
              {triagePatient.isPending ? 'Saving...' : 'Save Assessment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default TriageAssessmentDialog;
