import { useReducer } from "react";

import {
  useUpdatePrescription,
  useDiscontinuePrescription,
  useHoldPrescription,
  useResumePrescription,
  useRenewPrescription,
} from "@/hooks/usePrescriptionMutations";
import { PrescriptionActionDialogFrame } from './PrescriptionActionsDialogSections';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

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
        dosage: prescription?.dosage || prescription?.dose || '',
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
  const rustV2Mode = isRustV2ApiMode();
  const actionUnavailable = rustV2Mode && action === 'renew'
    ? 'To prescribe another course, create a new prescription from the current care context. Renewal is not available for this prescription.'
    : null;

  // Mutations
  const updateMutation = useUpdatePrescription();
  const discontinueMutation = useDiscontinuePrescription();
  const holdMutation = useHoldPrescription();
  const resumeMutation = useResumePrescription();
  const renewMutation = useRenewPrescription();

  const mutation = {
    edit: updateMutation,
    discontinue: discontinueMutation,
    hold: holdMutation,
    resume: resumeMutation,
    renew: renewMutation,
  }[action] || null;
  const isLoading = mutation?.isPending;

  // Validate form
  const validate = () => {
    const newErrors = {};
    if (actionUnavailable) return false;

    if (action === 'edit') {
      if (!formData.dosage?.trim()) {
        newErrors.dosage = 'Dosage is required';
      }
      if (formData.duration_days && (!Number.isInteger(Number(formData.duration_days)) || Number(formData.duration_days) < 1)) {
        newErrors.duration_days = 'Enter a whole number of at least one day.';
      }
    }

    if (action === 'discontinue' && !rustV2Mode) {
      if (!formData.reason?.trim()) {
        newErrors.reason = 'Reason is required for discontinuation';
      }
    }

    dispatch({ type: 'validationFailed', errors: newErrors });
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (isLoading || actionUnavailable) return;
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
              ...(formData.duration_days ? { duration_days: Number(formData.duration_days) } : {}),
              ...(!rustV2Mode ? { instructions: formData.instructions, reason: formData.reason } : {}),
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
    } catch {
      // Error is handled by the mutation's onError
    }
  };

  const updateActionField = (field, value) => {
    dispatch({ type: 'fieldChanged', field, value });
  };

  return (
    <PrescriptionActionDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      action={action}
      prescription={prescription}
      formData={formData}
      errors={errors}
      isLoading={isLoading}
      clinicalTextFieldsAvailable={!rustV2Mode}
      actionUnavailable={actionUnavailable}
      onFieldChange={updateActionField}
      onSubmit={handleSubmit}
    />
  );
};

export default PrescriptionActionsDialog;
