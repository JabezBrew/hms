import { useState, useEffect } from "react";
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
import { X, Pill, AlertCircle, Check, Calendar } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";

/**
 * AddPrescriptionSlideOver - Split-screen panel for prescribing medications
 *
 * Features:
 * - Slides in from right without backdrop (timeline remains visible)
 * - Medication entry with route, frequency, duration
 * - Only available to doctors
 * - Backend API integration
 */
const AddPrescriptionSlideOver = ({
  open,
  onClose,
  patient,
  onPrescriptionCreated
}) => {
  // Get patient ID
  const patientId = patient?.local_data?.id || patient?.id;

  const queryClient = useQueryClient();

  // Form state
  const [formData, setFormData] = useState({
    medication_name: '',
    dosage: '',
    route: 'oral',
    frequency: 'daily',
    duration_days: '',
    start_date: new Date().toISOString().split('T')[0],
    instructions: '',
    reason: ''
  });

  const [errors, setErrors] = useState({});

  // Route options
  const routeOptions = [
    { value: 'oral', label: 'Oral (PO)' },
    { value: 'iv', label: 'Intravenous (IV)' },
    { value: 'im', label: 'Intramuscular (IM)' },
    { value: 'sc', label: 'Subcutaneous (SC)' },
    { value: 'topical', label: 'Topical' },
    { value: 'inhaled', label: 'Inhaled' },
    { value: 'sublingual', label: 'Sublingual (SL)' },
    { value: 'rectal', label: 'Rectal (PR)' },
    { value: 'ophthalmic', label: 'Ophthalmic' },
    { value: 'otic', label: 'Otic (Ear)' },
    { value: 'nasal', label: 'Nasal' },
    { value: 'transdermal', label: 'Transdermal' },
  ];

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

  // API mutation
  const createPrescriptionMutation = useMutation({
    mutationFn: async (data) => {
      const response = await apiClient.post('/clinical-notes/prescriptions/', data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prescriptions'] });
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
    }
  });

  // Reset form when panel closes
  useEffect(() => {
    if (!open) {
      setFormData({
        medication_name: '',
        dosage: '',
        route: 'oral',
        frequency: 'daily',
        duration_days: '',
        start_date: new Date().toISOString().split('T')[0],
        instructions: '',
        reason: ''
      });
      setErrors({});
    }
  }, [open]);

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

    if (!formData.medication_name.trim()) {
      newErrors.medication_name = 'Medication name is required';
    }

    if (!formData.dosage.trim()) {
      newErrors.dosage = 'Dosage is required';
    }

    if (!formData.route) {
      newErrors.route = 'Route is required';
    }

    if (!formData.frequency) {
      newErrors.frequency = 'Frequency is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!validate()) return;

    // Build data object
    const data = {
      patient: patientId,
      medication_name: formData.medication_name.trim(),
      dosage: formData.dosage.trim(),
      route: formData.route,
      frequency: formData.frequency,
      start_date: formData.start_date,
    };

    if (formData.duration_days) {
      data.duration_days = parseInt(formData.duration_days);
    }

    if (formData.instructions.trim()) {
      data.instructions = formData.instructions.trim();
    }

    if (formData.reason.trim()) {
      data.reason = formData.reason.trim();
    }

    try {
      await createPrescriptionMutation.mutateAsync(data);
      toast.success('Prescription created successfully');
      onPrescriptionCreated?.();
      onClose();
    } catch (err) {
      console.error('Failed to create prescription:', err);
      if (err.message?.includes('Only doctors')) {
        toast.error('Only doctors can create prescriptions');
      } else {
        toast.error(err.message || 'Failed to create prescription');
      }
    }
  };

  // Handle close
  const handleClose = () => {
    setFormData({
      medication_name: '',
      dosage: '',
      route: 'oral',
      frequency: 'daily',
      duration_days: '',
      start_date: new Date().toISOString().split('T')[0],
      instructions: '',
      reason: ''
    });
    setErrors({});
    onClose();
  };

  // Get patient display name
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.name || 'Patient';

  // Get patient allergies for warning
  const allergies = patient?.local_data?.allergies || patient?.allergies || '';

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
          <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/30">
            <Pill className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">
              Prescribe Medication
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

      {/* Allergy Warning */}
      {allergies && (
        <div className="px-6 pt-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <span className="font-semibold">Patient Allergies:</span> {allergies}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
        <div className="space-y-6">
          {/* Medication Name */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Medication Name *
            </Label>
            <Input
              placeholder="e.g., Amoxicillin, Metformin, Lisinopril"
              value={formData.medication_name}
              onChange={(e) => handleChange('medication_name', e.target.value)}
              className={cn(
                "font-mono",
                errors.medication_name && "border-red-500"
              )}
            />
            {errors.medication_name && (
              <p className="text-xs text-red-500">{errors.medication_name}</p>
            )}
          </div>

          {/* Dosage */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Dosage *
            </Label>
            <Input
              placeholder="e.g., 500mg, 10ml, 2 tablets"
              value={formData.dosage}
              onChange={(e) => handleChange('dosage', e.target.value)}
              className={cn(
                "font-mono",
                errors.dosage && "border-red-500"
              )}
            />
            {errors.dosage && (
              <p className="text-xs text-red-500">{errors.dosage}</p>
            )}
          </div>

          {/* Route and Frequency */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Route *
              </Label>
              <Select
                value={formData.route}
                onValueChange={(value) => handleChange('route', value)}
              >
                <SelectTrigger className={cn(
                  "font-mono",
                  errors.route && "border-red-500"
                )}>
                  <SelectValue placeholder="Select route" />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {routeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="font-mono">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.route && (
                <p className="text-xs text-red-500">{errors.route}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Frequency *
              </Label>
              <Select
                value={formData.frequency}
                onValueChange={(value) => handleChange('frequency', value)}
              >
                <SelectTrigger className={cn(
                  "font-mono",
                  errors.frequency && "border-red-500"
                )}>
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {frequencyOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="font-mono">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.frequency && (
                <p className="text-xs text-red-500">{errors.frequency}</p>
              )}
            </div>
          </div>

          {/* Duration and Start Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Duration (days)
              </Label>
              <Input
                type="number"
                placeholder="e.g., 7, 14, 30"
                value={formData.duration_days}
                onChange={(e) => handleChange('duration_days', e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Leave empty for ongoing</p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                Start Date
              </Label>
              <Input
                type="date"
                value={formData.start_date}
                onChange={(e) => handleChange('start_date', e.target.value)}
                className="font-mono"
              />
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Reason for Prescription
            </Label>
            <Input
              placeholder="e.g., Bacterial infection, Hypertension management"
              value={formData.reason}
              onChange={(e) => handleChange('reason', e.target.value)}
              className="font-mono"
            />
          </div>

          {/* Special Instructions */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Special Instructions
            </Label>
            <Textarea
              placeholder="e.g., Take with food, Avoid alcohol, Take 30 minutes before meals"
              value={formData.instructions}
              onChange={(e) => handleChange('instructions', e.target.value)}
              className="font-mono min-h-[80px]"
            />
          </div>

          {/* Prescription Summary */}
          {formData.medication_name && formData.dosage && (
            <div className="p-4 bg-muted/50 rounded-lg border border-border">
              <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Prescription Summary
              </h3>
              <p className="font-mono text-sm">
                <span className="font-semibold">{formData.medication_name}</span>{' '}
                {formData.dosage}{' '}
                <span className="text-muted-foreground">
                  via {routeOptions.find(r => r.value === formData.route)?.label || formData.route}
                </span>{' '}
                <span className="text-muted-foreground">
                  {frequencyOptions.find(f => f.value === formData.frequency)?.label || formData.frequency}
                </span>
                {formData.duration_days && (
                  <span className="text-muted-foreground"> for {formData.duration_days} days</span>
                )}
              </p>
              {formData.instructions && (
                <p className="font-mono text-xs text-muted-foreground mt-2">
                  Instructions: {formData.instructions}
                </p>
              )}
            </div>
          )}
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
            disabled={createPrescriptionMutation.isPending}
            className="font-mono text-xs"
          >
            {createPrescriptionMutation.isPending ? (
              'Creating...'
            ) : (
              <>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Create Prescription
              </>
            )}
          </Button>
        </div>
      </footer>
    </div>
  );
};

export default AddPrescriptionSlideOver;
export { AddPrescriptionSlideOver };
