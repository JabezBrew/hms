/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import { useState, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import {
  useCreateAvailabilityRule,
  useUpdateAvailabilityRule,
} from '@/features/appointments/hooks/useAppointmentQueries';
import { useSearchPractitioners } from '@/features/staff/hooks';
import { previewSlots } from '@/features/appointments/api';
import { PersonalCalendarPractitionerFields } from './PersonalCalendarPractitionerFields';
import { PersonalCalendarPreviewActions } from './PersonalCalendarPreviewActions';
import { PersonalCalendarScheduleFields } from './PersonalCalendarScheduleFields';
import { PersonalCalendarTemplateSharing } from './PersonalCalendarTemplateSharing';
import {
  buildAvailabilityRulePayload,
  getCreateAvailabilitySuccessMessage,
  getPersonalCalendarDefaultValues,
  getPractitionerOptions,
  personalCalendarFormSchema,
} from './personalCalendarFormUtils';

const PersonalCalendarForm = ({ initialData = null, onSuccess }) => {
  const { user } = useAuth();
  const isDoctor = user?.role === 'doctor';
  const isAdmin = user?.role === 'admin';
  const currentUserPractitionerId = user?.practitionerId;
  const currentUserName = user ? `${user.firstName} ${user.lastName}` : '';
  const isEditing = Boolean(initialData);
  const canShareTemplate = isAdmin && !initialData;
  const shouldAutoFillPractitioner = isDoctor && currentUserPractitionerId && !isEditing;
  const initialPractitionerId = initialData?.practitioner || '';
  const initialPractitionerName = initialData?.practitioner_name || '';

  const [submitting, setSubmitting] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [selectedSharedPractitioner, setSelectedSharedPractitioner] = useState(null);

  const {
    data: practitioners = [],
    isLoading,
    isError: isPractitionersError,
    error: practitionersError,
    setSearchTerm,
  } = useSearchPractitioners(false, {
    minLength: 2,
  });

  const createAvailabilityRuleMutation = useCreateAvailabilityRule();
  const updateAvailabilityRuleMutation = useUpdateAvailabilityRule();

  const practitionerOptions = useMemo(() => {
    const options = getPractitionerOptions(practitioners);
    if (!isEditing || !initialPractitionerId || !initialPractitionerName) {
      return options;
    }

    const hasInitialPractitioner = options.some((option) => option.value === initialPractitionerId);
    if (hasInitialPractitioner) {
      return options;
    }

    return [
      {
        label: initialPractitionerName,
        value: initialPractitionerId,
      },
      ...options,
    ];
  }, [isEditing, initialPractitionerId, initialPractitionerName, practitioners]);

  const form = useForm({
    resolver: zodResolver(personalCalendarFormSchema),
    defaultValues: getPersonalCalendarDefaultValues(
      initialData,
      shouldAutoFillPractitioner,
      currentUserPractitionerId
    ),
  });

  const selectedPrimaryPractitioner = useWatch({
    control: form.control,
    name: 'practitioner',
    defaultValue: '',
  });
  const selectedSharedPractitioners = useWatch({
    control: form.control,
    name: 'practitioners',
    defaultValue: [],
  });

  const selectedSharedOptionMap = useMemo(() => {
    const map = new Map();
    practitionerOptions.forEach((option) => map.set(option.value, option));
    return map;
  }, [practitionerOptions]);

  const availableSharedPractitionerOptions = useMemo(() => {
    return practitionerOptions.filter((option) => {
      if (!option?.value) return false;
      if (option.value === selectedPrimaryPractitioner) return false;
      if (selectedSharedPractitioners.includes(option.value)) return false;
      return true;
    });
  }, [practitionerOptions, selectedPrimaryPractitioner, selectedSharedPractitioners]);

  const practitionerSearchErrorMessage = isPractitionersError
    ? practitionersError?.message || 'Failed to search practitioners'
    : '';

  const addSharedPractitioner = () => {
    if (!selectedSharedPractitioner) return;

    const current = form.getValues('practitioners') || [];
    if (!current.includes(selectedSharedPractitioner)) {
      form.setValue('practitioners', [...current, selectedSharedPractitioner], {
        shouldValidate: true,
      });
    }
    setSelectedSharedPractitioner(null);
  };

  const removeSharedPractitioner = (practitionerId) => {
    const current = form.getValues('practitioners') || [];
    form.setValue(
      'practitioners',
      current.filter((id) => id !== practitionerId),
      { shouldValidate: true }
    );
  };

  const handlePreview = async () => {
    const values = form.getValues();

    if (!values.start_time || !values.end_time || !values.slot_duration) {
      toast.error('Please fill in start time, end time, and slot duration to preview slots.');
      return;
    }

    setIsPreviewLoading(true);
    try {
      const result = await previewSlots({
        start_time: values.start_time,
        end_time: values.end_time,
        slot_duration: values.slot_duration,
        breaks: values.breaks || [],
      });
      setPreviewData(result.slots);
      setIsPreviewOpen(true);
    } catch (error) {
      toast.error(error?.message || 'Failed to generate preview.');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const onSubmit = async (data) => {
    setSubmitting(true);
    try {
      const formattedData = buildAvailabilityRulePayload(data, {
        canShareTemplate,
        isEditing,
      });

      if (isEditing) {
        updateAvailabilityRuleMutation.mutate(
          { id: initialData.id, data: formattedData },
          {
            onSuccess: (result) => {
              toast.success('Personal calendar rule updated successfully');
              onSuccess?.(result);
            },
            onError: (error) => {
              toast.error(error?.message || 'Failed to update personal calendar rule');
            },
            onSettled: () => {
              setSubmitting(false);
            },
          }
        );
        return;
      }

      createAvailabilityRuleMutation.mutate(
        formattedData,
        {
          onSuccess: (result) => {
            toast.success(getCreateAvailabilitySuccessMessage(result));
            onSuccess?.(result);
          },
          onError: (error) => {
            toast.error(error?.message || 'Failed to create personal calendar rule');
          },
          onSettled: () => {
            setSubmitting(false);
          },
        }
      );
    } catch (error) {
      toast.error(error?.message || 'Failed to prepare personal calendar rule data');
      setSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-heading text-sm font-medium">Rule Name</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g., Regular Office Hours"
                  className="font-mono text-sm"
                  {...field}
                  disabled={submitting}
                />
              </FormControl>
              <FormDescription className="text-xs text-muted-foreground">
                A descriptive name for this personal calendar rule.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <PersonalCalendarPractitionerFields
          currentUserName={currentUserName}
          form={form}
          isEditing={isEditing}
          isLoading={isLoading}
          practitionerOptions={practitionerOptions}
          practitionerSearchErrorMessage={practitionerSearchErrorMessage}
          setSearchTerm={setSearchTerm}
          shouldAutoFillPractitioner={shouldAutoFillPractitioner}
          submitting={submitting}
        />

        {canShareTemplate ? (
          <PersonalCalendarTemplateSharing
            addSharedPractitioner={addSharedPractitioner}
            availableSharedPractitionerOptions={availableSharedPractitionerOptions}
            form={form}
            isLoading={isLoading}
            removeSharedPractitioner={removeSharedPractitioner}
            selectedSharedOptionMap={selectedSharedOptionMap}
            selectedSharedPractitioner={selectedSharedPractitioner}
            selectedSharedPractitioners={selectedSharedPractitioners}
            setSearchTerm={setSearchTerm}
            setSelectedSharedPractitioner={setSelectedSharedPractitioner}
            submitting={submitting}
          />
        ) : null}

        <PersonalCalendarScheduleFields
          form={form}
          submitting={submitting}
        />

        <PersonalCalendarPreviewActions
          isEditing={isEditing}
          isPreviewLoading={isPreviewLoading}
          isPreviewOpen={isPreviewOpen}
          onPreview={handlePreview}
          previewData={previewData}
          setIsPreviewOpen={setIsPreviewOpen}
          submitting={submitting}
        />
      </form>
    </Form>
  );
};

export default PersonalCalendarForm;
