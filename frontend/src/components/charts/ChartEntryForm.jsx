/**
 * ChartEntryForm - Chronicle-styled slide-over for recording chart observations
 *
 * Dynamic form that renders fields based on chart template definition.
 * Includes real-time formula calculations and critical value warnings.
 */

import X from 'lucide-react/dist/esm/icons/x.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

import format from "date-fns/format";
import { toast } from "sonner";
import { ChartFieldRenderer } from "./ChartFieldRenderer";
import {
  useChartAssignment,
  useCreateChartEntry,
} from "@/hooks/useChartQueries";

/**
 * ChartEntryForm - Slide-over for recording chart observations
 */
const ChartEntryForm = ({
  open,
  onClose,
  assignmentId,
  patient,
  onEntryRecorded,
}) => {
  // Fetch assignment with template
  const { data: assignment, isLoading } = useChartAssignment(assignmentId);
  const createMutation = useCreateChartEntry();

  // Form state
  const [formData, setFormData] = useState({});
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});

  // Initialize form when assignment loads
  useEffect(() => {
    if (assignment?.template?.fields) {
      const initialData = {};
      assignment.template.fields.forEach((field) => {
        initialData[field.field_key] = field.config?.default ?? null;
      });
      setFormData(initialData);
      setErrors({});
    }
  }, [assignment]);

  // Reset form when panel closes
  useEffect(() => {
    if (!open) {
      setNotes('');
      setErrors({});
    }
  }, [open]);

  // Get patient display info
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.name || 'Patient';

  const template = assignment?.template;

  // Compute calculated fields
  const computedData = useMemo(() => {
    if (!template?.fields) return formData;

    const result = { ...formData };
    const calculatedFields = template.fields.filter((f) => f.field_type === 'calculated');

    calculatedFields.forEach((field) => {
      const formula = field.config?.formula;
      if (formula) {
        try {
          const value = evaluateFormula(formula, result);
          if (value !== null) {
            result[field.field_key] = value;
          }
        } catch {
          // Skip on error
        }
      }
    });

    return result;
  }, [formData, template]);

  // Check for critical values
  const criticalFields = useMemo(() => {
    if (!template?.fields) return [];

    const critical = [];
    template.fields.forEach((field) => {
      if (field.field_type === 'numeric' || field.field_type === 'scale') {
        const value = computedData[field.field_key];
        if (value !== null && value !== undefined) {
          const config = field.config || {};
          const { critical_low, critical_high } = config;

          if (critical_low !== undefined && value < critical_low) {
            critical.push(field.field_key);
          } else if (critical_high !== undefined && value > critical_high) {
            critical.push(field.field_key);
          }
        }
      }
    });

    return critical;
  }, [computedData, template]);

  // Update field value
  const updateField = (fieldKey, value) => {
    setFormData((prev) => ({
      ...prev,
      [fieldKey]: value,
    }));
    // Clear error when user types
    if (errors[fieldKey]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[fieldKey];
        return newErrors;
      });
    }
  };

  // Validate form
  const validateForm = () => {
    if (!template?.fields) return false;

    const newErrors = {};
    template.fields.forEach((field) => {
      if (field.is_required && field.field_type !== 'calculated') {
        const value = computedData[field.field_key];
        if (value === null || value === undefined || value === '') {
          newErrors[field.field_key] = `${field.name} is required`;
        }
      }

      // Validate numeric ranges
      if (field.field_type === 'numeric') {
        const value = computedData[field.field_key];
        if (value !== null && value !== undefined) {
          const config = field.config || {};
          if (config.min !== undefined && value < config.min) {
            newErrors[field.field_key] = `Must be at least ${config.min}`;
          }
          if (config.max !== undefined && value > config.max) {
            newErrors[field.field_key] = `Must be at most ${config.max}`;
          }
        }
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submit
  const handleSubmit = async () => {
    if (!validateForm()) {
      toast.error('Please fix the errors before saving');
      return;
    }

    try {
      await createMutation.mutateAsync({
        assignment: assignmentId,
        data: computedData,
        notes,
      });

      // Reset form for next entry
      if (template?.fields) {
        const initialData = {};
        template.fields.forEach((field) => {
          initialData[field.field_key] = field.config?.default ?? null;
        });
        setFormData(initialData);
      }
      setNotes('');

      onEntryRecorded?.();
    } catch (err) {
      console.error('Failed to record entry:', err);
    }
  };

  // Group fields by group_name
  const groupedFields = useMemo(() => {
    if (!template?.fields) return [];

    const groups = {};
    const ungrouped = [];

    template.fields.forEach((field) => {
      if (field.group_name) {
        if (!groups[field.group_name]) {
          groups[field.group_name] = [];
        }
        groups[field.group_name].push(field);
      } else {
        ungrouped.push(field);
      }
    });

    const result = [];
    Object.entries(groups).forEach(([name, fields]) => {
      result.push({ name, fields });
    });
    if (ungrouped.length > 0) {
      result.push({ name: null, fields: ungrouped });
    }

    return result;
  }, [template]);

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
          <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <ClipboardList className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">
              {template?.name || 'Chart Entry'}
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
          <X className="h-4 w-4 mr-1.5" />
          Close
        </Button>
      </header>

      {/* Timestamp & Status */}
      <div className="px-6 py-3 bg-muted/30 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 font-mono">
              <Calendar className="h-3.5 w-3.5" />
              {format(new Date(), 'MMM d, yyyy')}
            </span>
            <span className="flex items-center gap-1.5 font-mono">
              <Clock className="h-3.5 w-3.5" />
              {format(new Date(), 'h:mm a')}
            </span>
          </div>
          {criticalFields.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-mono text-rose-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              {criticalFields.length} critical value(s)
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 px-6 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !template ? (
          <div className="text-center py-12 text-muted-foreground">
            <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Chart template not found</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groupedFields.map((group, groupIndex) => (
              <div key={group.name || groupIndex}>
                {group.name && (
                  <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3 pb-2 border-b border-border">
                    {group.name}
                  </h3>
                )}
                <div className="space-y-4">
                  {group.fields.map((field) => (
                    <ChartFieldRenderer
                      key={field.id}
                      field={field}
                      value={computedData[field.field_key]}
                      onChange={(value) => updateField(field.field_key, value)}
                      error={errors[field.field_key]}
                      disabled={field.field_type === 'calculated'}
                      inSlideOver
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* Notes */}
            <div className="space-y-2 pt-4 border-t border-border">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Notes
              </Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional observations..."
                className="font-mono text-sm resize-none"
                rows={3}
              />
            </div>
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-border bg-card">
        <div className="flex items-center justify-between">
          {criticalFields.length > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-rose-500 font-mono">
              <AlertTriangle className="h-3.5 w-3.5" />
              Critical values will trigger an alert
            </p>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="font-mono text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={createMutation.isPending || !template}
              className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Record Entry
                </>
              )}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
};

/**
 * Simple formula evaluator for frontend preview
 */
function evaluateFormula(formula, data) {
  // Replace field references with values
  let expression = formula.replace(/\{([a-z_][a-z0-9_]*)\}/g, (match, key) => {
    const value = data[key];
    if (value === null || value === undefined) {
      throw new Error(`Missing value for ${key}`);
    }
    return String(value);
  });

  // Only allow safe characters
  if (!/^[\d\s+\-*/().]+$/.test(expression)) {
    throw new Error('Invalid formula');
  }

  // Evaluate
  try {
    const result = new Function(`return ${expression}`)();
    return typeof result === 'number' ? Math.round(result * 100) / 100 : null;
  } catch {
    return null;
  }
}

export { ChartEntryForm };
export default ChartEntryForm;
