import User from 'lucide-react/dist/esm/icons/user.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Heart from 'lucide-react/dist/esm/icons/heart.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

const DEFAULT_EMPTY_ARRAY = [];

import { cn } from '@/lib/utils';
import { getShiftLabel } from '@/config/shiftConfig';

/**
 * ReviewStep - Review all handoff information before submission
 */
export function ReviewStep({
  formData,
  selectedPatient,
  nurses = DEFAULT_EMPTY_ARRAY
}) {
  const selectedNurse = nurses.find(n => String(n.id) === formData.to_nurse);
  const shiftLabel = getShiftLabel(formData.shift_type);

  const sections = [
    {
      icon: Heart,
      label: 'Patient Condition',
      value: formData.patient_condition,
      required: true
    },
    {
      icon: AlertCircle,
      label: 'Ongoing Issues',
      value: formData.ongoing_issues
    },
    {
      icon: Pill,
      label: 'Medication Changes',
      value: formData.medication_changes
    },
    {
      icon: ClipboardList,
      label: 'Pending Tasks',
      value: formData.pending_tasks,
      required: true
    },
    {
      icon: Calendar,
      label: 'Key Events',
      value: formData.key_events
    },
    {
      icon: FileText,
      label: 'Care Plan Updates',
      value: formData.care_plan_updates
    },
    {
      icon: Users,
      label: 'Family Updates',
      value: formData.family_updates
    }
  ];

  return (
    <div className="space-y-6">
      {/* Patient Summary */}
      <div className="p-5 rounded-xl bg-amber-500/5 border border-amber-500/20">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-lg bg-amber-500/10">
            <User className="size-6 text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="font-mono text-[10px] uppercase tracking-wider text-amber-600 mb-1">
              Patient
            </p>
            <p className="font-display text-xl font-medium">
              {selectedPatient?.patient_name}
            </p>
            <p className="font-mono text-xs text-muted-foreground mt-1">
              MRN: {selectedPatient?.patient_mrn}
              {selectedPatient?.ward_name && ` | ${selectedPatient.ward_name} - Bed ${selectedPatient.bed_number}`}
            </p>
          </div>
        </div>
      </div>

      {/* Shift Details */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="size-4 text-muted-foreground" />
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Shift Type
            </p>
          </div>
          <p className="font-mono text-sm">{shiftLabel || formData.shift_type}</p>
        </div>
        <div className="p-4 rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 mb-2">
            <User className="size-4 text-muted-foreground" />
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Receiving Nurse
            </p>
          </div>
          <p className="font-mono text-sm">
            {selectedNurse?.full_name || selectedNurse?.name || 'Not selected'}
          </p>
        </div>
      </div>

      <Separator />

      {/* Clinical Information */}
      <div className="space-y-4">
        {sections.map((section) => {
          if (!section.value && !section.required) return null;

          const Icon = section.icon;
          return (
            <div key={section.label} className="space-y-2">
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-muted-foreground" />
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {section.label}
                  {section.required && <span className="text-rose-500 ml-1">*</span>}
                </p>
              </div>
              <div className={cn(
                "p-3 rounded-lg border",
                section.value ? "bg-card border-border" : "bg-rose-500/5 border-rose-500/20"
              )}>
                <p className={cn(
                  "font-mono text-sm whitespace-pre-wrap",
                  !section.value && "text-rose-500 italic"
                )}>
                  {section.value || 'Required - please go back and fill in'}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Validation Warning */}
      {!formData.to_nurse && (
        <Alert className="border-rose-500/30 bg-rose-500/5">
          <AlertCircle className="size-4 text-rose-500" />
          <AlertDescription className="text-rose-600 font-mono text-sm">
            Please select a receiving nurse before submitting
          </AlertDescription>
        </Alert>
      )}

      {/* Success Message */}
      {formData.to_nurse && formData.patient_condition && formData.pending_tasks && (
        <div className="text-center py-4">
          <p className="font-mono text-sm text-muted-foreground">
            Review the information above and click Complete Handoff when ready
          </p>
        </div>
      )}
    </div>
  );
}
