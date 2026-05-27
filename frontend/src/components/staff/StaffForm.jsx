import { useCallback, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';

import { Card, CardContent } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { Tabs } from '@/components/ui/tabs';
import { useClinicalUnits } from '@/features/admin/hooks';
import { useRegisterStaff } from '@/features/staff/hooks';

import { StaffContactStep } from './staff-form/StaffContactStep';
import { StaffCredentialsStep } from './staff-form/StaffCredentialsStep';
import { StaffEmploymentStep } from './staff-form/StaffEmploymentStep';
import { StaffFormActions } from './staff-form/StaffFormActions';
import { StaffIdentityStep } from './staff-form/StaffIdentityStep';
import { StaffReviewStep } from './staff-form/StaffReviewStep';
import { StaffStepNavigation } from './staff-form/StaffStepNavigation';
import { StaffValidationAlert } from './staff-form/StaffValidationAlert';
import { useCurrentDate } from './staff-form/staffFormDate';
import {
  buildRegistrationPayload,
  defaultValues,
  isPractitionerUserType,
  staffFieldToStep,
  staffFormSchema,
  staffStepDefs,
  stepFieldsByKey,
} from './staffForm.utils';

const PRACTITIONER_FIELDS = ['license_number', 'specialization', 'qualification'];

const getStepKeys = () => staffStepDefs.map((step) => step.key);

const getFieldsForStep = (stepKey, isPractitioner) => {
  const fields = stepFieldsByKey[stepKey] || [];
  if (stepKey === 'credentials' && !isPractitioner) {
    return fields.filter((field) => field === 'temporary_password');
  }
  return fields;
};

const StaffForm = ({ onSuccess }) => {
  const registerStaffMutation = useRegisterStaff();
  const [isLoading, setIsLoading] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const currentDate = useCurrentDate();

  const stepKeys = useMemo(getStepKeys, []);
  const [activeStep, setActiveStep] = useState(stepKeys[0]);

  const form = useForm({
    resolver: zodResolver(staffFormSchema),
    defaultValues,
  });

  const { data: departmentUnits = [], isLoading: isDepartmentsLoading } = useClinicalUnits({
    unit_type_code: 'department',
    is_active: true,
  });

  const departmentOptions = useMemo(() => {
    const options = [];
    for (const unit of (Array.isArray(departmentUnits) ? departmentUnits : [])) {
      if (typeof unit?.id === 'string' && typeof unit?.name === 'string' && unit.name.trim()) {
        options.push({
          id: unit.id,
          name: unit.name.trim(),
        });
      }
    }
    return options.sort((a, b) => a.name.localeCompare(b.name));
  }, [departmentUnits]);

  const departmentNameById = useMemo(
    () => new Map(departmentOptions.map((department) => [department.id, department.name])),
    [departmentOptions]
  );

  const userType = form.watch('user_type');
  const dateOfBirth = form.watch('date_of_birth');
  const isPractitioner = isPractitionerUserType(userType);
  const currentStepIndex = stepKeys.indexOf(activeStep);
  const isFirstStep = currentStepIndex <= 0;
  const isLastStep = currentStepIndex === stepKeys.length - 1;
  const isSubmitting = isLoading || registerStaffMutation.isPending;

  const goToStep = useCallback((stepKey, focusField = null) => {
    setActiveStep(stepKey);
    if (focusField) {
      setTimeout(() => form.setFocus(focusField), 0);
    }
  }, [form]);

  const validateStep = useCallback(async (stepKey) => {
    const fieldsToValidate = getFieldsForStep(stepKey, isPractitioner);
    if (!fieldsToValidate.length) return true;
    return form.trigger(fieldsToValidate);
  }, [form, isPractitioner]);

  const goToFirstErrorStep = useCallback(() => {
    const errors = form.formState.errors || {};
    const errorFields = Object.keys(errors);
    const firstErrorByStep = new Map();

    for (const field of errorFields) {
      const step = staffFieldToStep[field];
      if (step && !firstErrorByStep.has(step)) {
        firstErrorByStep.set(step, field);
      }
    }

    for (const step of stepKeys) {
      const firstField = firstErrorByStep.get(step);
      if (firstField) {
        goToStep(step, firstField);
        return;
      }
    }
  }, [form.formState.errors, goToStep, stepKeys]);

  const handleBack = useCallback(() => {
    if (isFirstStep) return;
    setShowValidation(false);
    setActiveStep(stepKeys[currentStepIndex - 1]);
  }, [currentStepIndex, isFirstStep, stepKeys]);

  const handleNext = useCallback(async () => {
    setShowValidation(true);
    const ok = await validateStep(activeStep);
    if (!ok) {
      goToFirstErrorStep();
      return false;
    }
    if (isLastStep) return true;
    setActiveStep(stepKeys[currentStepIndex + 1]);
    return true;
  }, [activeStep, currentStepIndex, goToFirstErrorStep, isLastStep, stepKeys, validateStep]);

  const clearPractitionerFields = useCallback(() => {
    for (const field of PRACTITIONER_FIELDS) {
      form.setValue(field, '');
    }
    form.clearErrors(PRACTITIONER_FIELDS);
  }, [form]);

  const validateRegistration = useCallback(async () => {
    const fieldsToValidate = stepKeys.flatMap((stepKey) => (
      getFieldsForStep(stepKey, isPractitioner)
    ));
    const ok = await form.trigger(fieldsToValidate);
    if (!ok) {
      goToFirstErrorStep();
    }
    return ok;
  }, [form, goToFirstErrorStep, isPractitioner, stepKeys]);

  const submitRegistration = useCallback(async (values) => {
    setIsLoading(true);
    try {
      const payload = buildRegistrationPayload(values, {
        resolveDepartment: (departmentValue) => (
          departmentNameById.get(departmentValue) || departmentValue
        ),
      });
      const response = await registerStaffMutation.mutateAsync(payload);
      const responseData = response?.data !== undefined ? response.data : response;

      form.reset(defaultValues);
      setShowValidation(false);
      setActiveStep(stepKeys[0]);

      if (onSuccess) {
        onSuccess(responseData);
      }
    } catch (error) {
      toast.error(error.message || 'Failed to register staff member');
    } finally {
      setIsLoading(false);
    }
  }, [departmentNameById, form, onSuccess, registerStaffMutation, stepKeys]);

  const onFormSubmit = useCallback(async (values) => {
    if (activeStep !== 'review') {
      await handleNext();
      return;
    }

    setShowValidation(true);
    if (!(await validateRegistration())) {
      return;
    }

    await submitRegistration(values);
  }, [activeStep, handleNext, submitRegistration, validateRegistration]);

  const stepErrorCounts = useMemo(() => {
    const errors = form.formState.errors || {};
    const counts = Object.fromEntries(stepKeys.map((step) => [step, 0]));
    Object.keys(errors).forEach((field) => {
      const step = staffFieldToStep[field];
      if (step && counts[step] !== undefined) {
        counts[step] += 1;
      }
    });
    return counts;
  }, [form.formState.errors, stepKeys]);

  const formErrors = form.formState.errors || {};
  const hasFormErrors = Object.keys(formErrors).length > 0;

  return (
    <Card className="w-full border-border">
      <CardContent className="pt-6">
        {showValidation && hasFormErrors ? (
          <StaffValidationAlert
            errors={formErrors}
            onGoToStep={goToStep}
            onGoToFirstErrorStep={goToFirstErrorStep}
          />
        ) : null}

        <Tabs value={activeStep} onValueChange={setActiveStep}>
          <StaffStepNavigation
            activeStep={activeStep}
            currentStepIndex={currentStepIndex}
            stepErrorCounts={stepErrorCounts}
          />

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onFormSubmit)} className="space-y-6">
              <StaffIdentityStep
                form={form}
                currentDate={currentDate}
                onUserTypeChange={clearPractitionerFields}
              />
              <StaffEmploymentStep
                form={form}
                currentDate={currentDate}
                dateOfBirth={dateOfBirth}
                departmentOptions={departmentOptions}
                isDepartmentsLoading={isDepartmentsLoading}
              />
              <StaffCredentialsStep
                form={form}
                isPractitioner={isPractitioner}
                userType={userType}
              />
              <StaffContactStep form={form} />
              <StaffReviewStep
                form={form}
                departmentNameById={departmentNameById}
                isPractitioner={isPractitioner}
              />

              <StaffFormActions
                isFirstStep={isFirstStep}
                isLastStep={isLastStep}
                isSubmitting={isSubmitting}
                onBack={handleBack}
                onNext={handleNext}
              />
            </form>
          </Form>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default StaffForm;
