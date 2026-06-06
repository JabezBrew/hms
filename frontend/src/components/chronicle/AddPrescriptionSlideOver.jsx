import { useReducer } from "react";
import { cn } from "@/lib/utils";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSafetyCheck, usePatientAllergies, useDrugForms } from "@/hooks/useDrugSafetyQueries";
import { DrugSafetyDialog } from "@/components/drug-safety/DrugSafetyDialog";
import { patientKeys } from "@/features/patients/hooks/usePatientQueries";
import {
  createPrescription as createPrescriptionRequest,
  invalidatePrescriptionMutationQueries,
} from "@/hooks/usePrescriptionMutations";
import { nursingKeys } from "@/hooks/useNursingQueries";
import { emitOnboardingEvent } from "@/features/onboarding";
import { isRustV2ApiMode } from "@/lib/api/v2/runtime";
import {
  PatientAllergyWarning,
  PrescriptionFormContent,
  PrescriptionSlideOverFooter,
  PrescriptionSlideOverHeader,
} from './AddPrescriptionSlideOverSections';

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

const buildPrescriptionPayload = ({
  patientId,
  encounterId,
  admissionCaseId,
  formData,
  marGenerationAvailable,
  generateMAR,
  marDays,
  overrideReason,
}) => {
  const data = {
    patient: patientId,
    medication_name: formData.medication_name.trim(),
    dosage: formData.dosage.trim(),
    route: formData.route,
    frequency: formData.frequency,
    start_date: formData.start_date,
  };

  if (encounterId) {
    data.encounter_id = encounterId;
  }

  if (admissionCaseId) {
    data.admission_case_id = admissionCaseId;
  }

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

  if (overrideReason) {
    data.safety_override_reason = overrideReason;
  }

  return data;
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
  encounter = null,
  onPrescriptionCreated
}) => {
  // Get patient ID
  const patientId = patient?.local_data?.id || patient?.id;
  const rustV2Mode = isRustV2ApiMode();
  const marGenerationAvailable = true;
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
  const admissionCaseId = encounter?.admission_id
    || encounter?.admission_case_id
    || patient?.local_data?.current_admission_id
    || patient?.current_admission_id
    || null;
  const encounterId = encounter?.id || encounter?.encounter_id || null;

  // Hooks for drug safety - only fetch when slide-over is open
  const safetyCheck = useSafetyCheck();
  const { data: allergiesData } = usePatientAllergies(patientId, { enabled: open });

  // Fetch drug forms when medication is selected and slide-over is open
  const { data: drugFormsData, isLoading: isLoadingForms } = useDrugForms(selectedRxcui, {
    enabled: open && drugSafetyEnhancementsAvailable && !!selectedRxcui,
  });
  const drugForms = drugFormsData?.forms || [];

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
  const updatePrescriptionField = (field, value) => {
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
    const data = buildPrescriptionPayload({
      patientId,
      encounterId,
      admissionCaseId,
      formData,
      marGenerationAvailable,
      generateMAR,
      marDays,
      overrideReason,
    });

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
      <PrescriptionSlideOverHeader patientName={patientName} onClose={handleClose} />
      <PatientAllergyWarning allergiesData={allergiesData} />
      <PrescriptionFormContent
        formData={formData}
        errors={errors}
        selectedRxcui={selectedRxcui}
        drugForms={drugForms}
        isLoadingForms={isLoadingForms}
        drugSafetyEnhancementsAvailable={drugSafetyEnhancementsAvailable}
        marGenerationAvailable={marGenerationAvailable}
        generateMAR={generateMAR}
        marDays={marDays}
        isPatientAdmitted={isPatientAdmitted}
        onMedicationSelect={handleMedicationSelect}
        onDrugFormSelect={handleDrugFormSelect}
        onFieldChange={updatePrescriptionField}
        onGenerateMARChange={(value) => dispatch({
          type: 'setGenerateMAR',
          value,
        })}
        onMarDaysChange={(value) => dispatch({
          type: 'setMarDays',
          value,
        })}
      />
      <PrescriptionSlideOverFooter
        isCreating={createPrescriptionMutation.isPending}
        safetyCheckPending={safetyCheckPending}
        onCancel={handleClose}
        onSubmit={handleSubmit}
      />

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
