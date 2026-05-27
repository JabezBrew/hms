import X from 'lucide-react/dist/esm/icons/x.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import { useReducer } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSafetyCheck, usePatientAllergies, useDrugForms } from "@/hooks/useDrugSafetyQueries";
import { DrugSafetyDialog } from "@/components/drug-safety/DrugSafetyDialog";
import { MedicationAutocomplete } from "@/components/drug-safety/MedicationAutocomplete";
import { patientKeys } from "@/features/patients/hooks/usePatientQueries";
import {
  createPrescription as createPrescriptionRequest,
  invalidatePrescriptionMutationQueries,
} from "@/hooks/usePrescriptionMutations";
import { nursingKeys } from "@/hooks/useNursingQueries";
import { emitOnboardingEvent } from "@/features/onboarding";
import { isRustV2ApiMode } from "@/lib/api/v2/runtime";

/**
 * AddPrescriptionSlideOver - Split-screen panel for prescribing medications
 *
 * Features:
 * - Slides in from right without backdrop (timeline remains visible)
 * - Medication entry with route, frequency, duration
 * - Auto-populates dosage and route from RxNorm drug forms
 * - Only available to doctors
 * - Backend API integration
 */
const createPrescriptionFormData = () => ({
  medication_name: '',
  dosage: '',
  route: 'oral',
  frequency: 'daily',
  duration_days: '',
  start_date: new Date().toISOString().split('T')[0],
  instructions: '',
  reason: ''
});

const createPrescriptionState = (marGenerationAvailable) => ({
  formData: createPrescriptionFormData(),
  generateMAR: marGenerationAvailable,
  marDays: 7,
  selectedRxcui: null,
  errors: {},
  safetyCheckPending: false,
  safetyDialogOpen: false,
  safetyAlerts: [],
  hasCriticalAlerts: false,
});

const withoutFieldError = (errors, field) => {
  if (!errors[field]) {
    return errors;
  }

  const nextErrors = { ...errors };
  delete nextErrors[field];
  return nextErrors;
};

const prescriptionReducer = (state, action) => {
  switch (action.type) {
    case 'reset':
      return createPrescriptionState(action.marGenerationAvailable);
    case 'fieldChanged':
      return {
        ...state,
        formData: {
          ...state.formData,
          [action.field]: action.value,
        },
        errors: withoutFieldError(state.errors, action.field),
      };
    case 'medicationSelected':
      return {
        ...state,
        formData: {
          ...state.formData,
          medication_name: action.name,
        },
        selectedRxcui: action.rxcui,
        errors: withoutFieldError(state.errors, 'medication_name'),
      };
    case 'drugFormSelected':
      return {
        ...state,
        formData: {
          ...state.formData,
          dosage: action.dosage,
          route: action.route,
        },
        errors: withoutFieldError(state.errors, 'dosage'),
      };
    case 'validationFailed':
      return {
        ...state,
        errors: action.errors,
      };
    case 'setGenerateMAR':
      return {
        ...state,
        generateMAR: action.value,
      };
    case 'setMarDays':
      return {
        ...state,
        marDays: action.value,
      };
    case 'safetyCheckStarted':
      return {
        ...state,
        safetyCheckPending: true,
      };
    case 'safetyCheckCompleted':
      return {
        ...state,
        safetyCheckPending: false,
        safetyAlerts: action.alerts,
        hasCriticalAlerts: action.hasCriticalAlerts,
        safetyDialogOpen: action.openDialog,
      };
    case 'setSafetyDialogOpen':
      return {
        ...state,
        safetyDialogOpen: action.open,
      };
    default:
      return state;
  }
};

const AddPrescriptionSlideOver = (props) => (
  <AddPrescriptionSlideOverContent
    key={props.open ? 'open' : 'closed'}
    {...props}
  />
);

const AddPrescriptionSlideOverContent = ({
  open,
  onClose,
  patient,
  onPrescriptionCreated
}) => {
  // Get patient ID
  const patientId = patient?.local_data?.id || patient?.id;
  const rustV2Mode = isRustV2ApiMode();
  const marGenerationAvailable = !rustV2Mode;
  const drugSafetyEnhancementsAvailable = !rustV2Mode;

  const queryClient = useQueryClient();

  const [state, dispatch] = useReducer(
    prescriptionReducer,
    marGenerationAvailable,
    createPrescriptionState,
  );
  const {
    formData,
    generateMAR,
    marDays,
    selectedRxcui,
    errors,
    safetyCheckPending,
    safetyDialogOpen,
    safetyAlerts,
    hasCriticalAlerts,
  } = state;

  // Check if patient is admitted (for MAR generation hint)
  const isPatientAdmitted = patient?.local_data?.current_admission || patient?.is_admitted || false;

  // Hooks for drug safety - only fetch when slide-over is open
  const safetyCheck = useSafetyCheck();
  const { data: allergiesData } = usePatientAllergies(patientId, { enabled: open });

  // Fetch drug forms when medication is selected and slide-over is open
  const { data: drugFormsData, isLoading: isLoadingForms } = useDrugForms(selectedRxcui, {
    enabled: open && drugSafetyEnhancementsAvailable && !!selectedRxcui,
  });
  const drugForms = drugFormsData?.forms || [];

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
    { value: 'vaginal', label: 'Vaginal' },
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
      const response = await createPrescriptionRequest(data);
      return response;
    },
    onSuccess: (data) => {
      void invalidatePrescriptionMutationQueries(queryClient, {
        prescriptionId: data?.id,
        patientId,
      });
      queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) });
    }
  });

  // Handle medication selection from autocomplete
  const handleMedicationSelect = (medication) => {
    dispatch({
      type: 'medicationSelected',
      name: medication.name,
      rxcui: drugSafetyEnhancementsAvailable ? medication.rxcui : null,
    });
  };

  // Handle drug form selection - auto-populate dosage and route
  const handleDrugFormSelect = (formRxcui) => {
    const selectedForm = drugForms.find(f => f.rxcui === formRxcui);
    if (selectedForm) {
      dispatch({
        type: 'drugFormSelected',
        dosage: selectedForm.strength,
        route: selectedForm.route,
      });
    }
  };

  // Handle input change
  const handleChange = (field, value) => {
    dispatch({ type: 'fieldChanged', field, value });
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

    dispatch({ type: 'validationFailed', errors: newErrors });
    return Object.keys(newErrors).length === 0;
  };

  // Perform drug safety check
  const performSafetyCheck = async () => {
    if (!validate()) return false;

    if (!drugSafetyEnhancementsAvailable) {
      return true;
    }

    dispatch({ type: 'safetyCheckStarted' });

    try {
      const result = await safetyCheck.mutateAsync({
        patient_id: patientId,
        medication_name: formData.medication_name.trim(),
      });

      dispatch({
        type: 'safetyCheckCompleted',
        alerts: result.alerts || [],
        hasCriticalAlerts: result.has_critical_alerts || false,
        openDialog: Boolean(result.has_alerts),
      });

      // If there are alerts, show the safety dialog
      if (result.has_alerts) {
        return false;
      }

      // No alerts, proceed with prescription
      return true;
    } catch (error) {
      console.error('Safety check failed:', error);
      // Check for permission-related errors
      const errorMsg = error.message?.toLowerCase() || '';
      if (errorMsg.includes('practitioner') || errorMsg.includes('doctor') || errorMsg.includes('permission')) {
        toast.error('Only doctors can prescribe medications');
      } else {
        toast.error('Safety check failed. Please try again.');
      }
      dispatch({
        type: 'safetyCheckCompleted',
        alerts: [],
        hasCriticalAlerts: false,
        openDialog: false,
      });
      return false;
    }
  };

  // Handle submit
  const handleSubmit = async () => {
    // Perform safety check first
    const canProceed = await performSafetyCheck();
    if (!canProceed) return;

    await createPrescription();
  };

  // Create prescription (called after safety check passes)
  const createPrescription = async (overrideReason = '') => {
    // Build data object
    const data = {
      patient: patientId,
      medication_name: formData.medication_name.trim(),
      dosage: formData.dosage.trim(),
      route: formData.route,
      frequency: formData.frequency,
      start_date: formData.start_date,
    };

    if (marGenerationAvailable) {
      data.generate_mar = generateMAR ? 'yes' : 'no';
      data.mar_days = marDays;
    }

    if (formData.duration_days) {
      data.duration_days = parseInt(formData.duration_days);
    }

    if (formData.instructions.trim()) {
      data.instructions = formData.instructions.trim();
    }

    if (formData.reason.trim()) {
      data.reason = formData.reason.trim();
    }

    // Add override reason if provided
    if (overrideReason) {
      data.safety_override_reason = overrideReason;
    }

    try {
      const result = await createPrescriptionMutation.mutateAsync(data);
      emitOnboardingEvent('chronicle.prescription_created', {
        success: true,
        prescription_id: result?.id || null,
        patient_id: patientId || null,
      });

      if (result.mar_generated) {
        toast.success('Prescription created and MAR entries generated for nursing');
      } else {
        toast.success('Prescription created successfully');
      }
      // Also invalidate MAR/medication queries
      queryClient.invalidateQueries({ queryKey: nursingKeys.patientMarAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.pendingDispensingAll() });
      queryClient.invalidateQueries({ queryKey: nursingKeys.medicationAdministrationsAll() });
      onPrescriptionCreated?.();
      onClose();
    } catch (err) {
      console.error('Failed to create prescription:', err);
      const errorMsg = err.message?.toLowerCase() || '';
      if (errorMsg.includes('practitioner') || errorMsg.includes('doctor') || errorMsg.includes('permission')) {
        toast.error('Only doctors can prescribe medications');
      } else {
        toast.error(err.message || 'Failed to create prescription');
      }
    }
  };

  // Handle safety dialog proceed
  const handleSafetyProceed = (overrideReason) => {
    dispatch({ type: 'setSafetyDialogOpen', open: false });
    void createPrescription(overrideReason);
  };

  // Handle safety dialog cancel
  const handleSafetyCancel = () => {
    dispatch({ type: 'setSafetyDialogOpen', open: false });
    toast.info('Prescription cancelled due to safety alerts');
  };

  // Handle close
  const handleClose = () => {
    dispatch({ type: 'reset', marGenerationAvailable });
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
          <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/30">
            <Pill className="size-5 text-sky-600 dark:text-sky-400" />
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
          <X className="size-4 mr-1.5" />
          Close
        </Button>
      </header>

      {/* Allergy Warning */}
      {allergiesData?.allergies?.length > 0 && (
        <div className="px-6 pt-4">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>
              <span className="font-semibold">Patient Allergies ({allergiesData.count}):</span>{' '}
              {allergiesData.allergies.reduce((allergenNames, allergy) => {
                if (allergy.is_active) {
                  allergenNames.push(allergy.allergen_name);
                }
                return allergenNames;
              }, []).join(', ')}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
        <div className="space-y-6">
          {/* Medication Name with Safety Check */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Shield className="size-3.5 text-sky-600" />
              {drugSafetyEnhancementsAvailable
                ? 'Medication Name * (with drug safety check)'
                : 'Medication Name *'}
            </Label>
            {drugSafetyEnhancementsAvailable ? (
              <MedicationAutocomplete
                value={formData.medication_name}
                onSelect={handleMedicationSelect}
                placeholder="Search for medication..."
                className={cn(
                  "font-mono",
                  errors.medication_name && "border-red-500"
                )}
              />
            ) : (
              <Input
                aria-label="Medication"
                placeholder="Enter medication name..."
                value={formData.medication_name}
                onChange={(event) => handleChange('medication_name', event.target.value)}
                className={cn(
                  "font-mono",
                  errors.medication_name && "border-red-500"
                )}
              />
            )}
            <p className="text-xs text-muted-foreground">
              {drugSafetyEnhancementsAvailable
                ? 'Drug interactions and allergy checks will be performed automatically'
                : 'Drug interaction checks are not exposed in Rust V2 yet; patient allergy warnings remain visible.'}
            </p>
            {errors.medication_name && (
              <p className="text-xs text-red-500">{errors.medication_name}</p>
            )}
          </div>

          {/* Drug Form Selector - Shows available strengths/forms from RxNorm */}
          {drugSafetyEnhancementsAvailable && selectedRxcui && (
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Package className="size-3.5 text-sky-600" />
                Select Formulation (Optional)
              </Label>
              {isLoadingForms ? (
                <div className="flex items-center gap-2 py-3 px-4 bg-muted/50 rounded-lg">
                  <Loader2 className="size-4 animate-spin text-sky-600" />
                  <span className="font-mono text-sm text-muted-foreground">
                    Loading available formulations…
                  </span>
                </div>
              ) : drugForms.length > 0 ? (
                <Select onValueChange={handleDrugFormSelect}>
                  <SelectTrigger className="font-mono">
                    <SelectValue placeholder="Select a formulation to auto-fill dosage & route" />
                  </SelectTrigger>
                  <SelectContent className="z-[200] max-h-[300px]">
                    {drugForms.map((form) => (
                      <SelectItem
                        key={form.rxcui}
                        value={form.rxcui}
                        className="font-mono"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{form.strength} - {form.dose_form}</span>
                          <span className="text-xs text-muted-foreground">
                            Route: {routeOptions.find(r => r.value === form.route)?.label || form.route}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground italic py-2">
                  No specific formulations found. Enter dosage manually below.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Selecting a formulation will auto-fill the dosage and route
              </p>
            </div>
          )}

          {/* Dosage */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Dosage *
            </Label>
            <Input
              placeholder="e.g., 500 MG, 10 ML, 2 tablets"
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
                <Calendar className="size-3.5" />
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

          {marGenerationAvailable ? (
            <div className="p-4 bg-sky-50 dark:bg-sky-900/20 rounded-lg border border-sky-200 dark:border-sky-800">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="generate-mar"
                  checked={generateMAR}
                  onCheckedChange={(value) => dispatch({
                    type: 'setGenerateMAR',
                    value: Boolean(value),
                  })}
                  className="mt-0.5"
                />
                <div className="flex-1 space-y-2">
                  <Label
                    htmlFor="generate-mar"
                    className="font-mono text-sm font-medium cursor-pointer flex items-center gap-2"
                  >
                    <ClipboardList className="size-4 text-sky-600" />
                    Generate Medication Administration Record (MAR)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Creates scheduled doses for nursing to administer and pharmacy to dispense.
                    {isPatientAdmitted && (
                      <span className="text-sky-600 font-medium"> Patient is currently admitted.</span>
                    )}
                  </p>
                  {generateMAR && (
                    <div className="flex items-center gap-2 pt-1">
                      <Label className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                        Generate for
                      </Label>
                      <Input
                        type="number"
                        min="1"
                        max="30"
                        value={marDays}
                        onChange={(e) => dispatch({
                          type: 'setMarDays',
                          value: parseInt(e.target.value) || 7,
                        })}
                        className="font-mono w-16 h-8 text-center"
                      />
                      <Label className="font-mono text-xs text-muted-foreground">
                        days
                      </Label>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <Alert>
              <ClipboardList className="size-4" />
              <AlertDescription>
                MAR generation is not available in Rust V2 mode yet.
              </AlertDescription>
            </Alert>
          )}

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
            disabled={createPrescriptionMutation.isPending || safetyCheckPending}
            className="font-mono text-xs"
          >
            {safetyCheckPending ? (
              <>
                <Shield className="size-3.5 mr-1.5 animate-pulse" />
                Checking Safety…
              </>
            ) : createPrescriptionMutation.isPending ? (
              'Creating…'
            ) : (
              <>
                <Check className="size-3.5 mr-1.5" />
                Create Prescription
              </>
            )}
          </Button>
        </div>
      </footer>

      {/* Drug Safety Dialog */}
      <DrugSafetyDialog
        open={safetyDialogOpen}
        onOpenChange={(nextOpen) => dispatch({
          type: 'setSafetyDialogOpen',
          open: nextOpen,
        })}
        alerts={safetyAlerts}
        hasCriticalAlerts={hasCriticalAlerts}
        medicationName={formData.medication_name}
        onProceed={handleSafetyProceed}
        onCancel={handleSafetyCancel}
        allowOverride={true}
        loading={createPrescriptionMutation.isPending}
      />
    </div>
  );
};

export default AddPrescriptionSlideOver;
export { AddPrescriptionSlideOver };
