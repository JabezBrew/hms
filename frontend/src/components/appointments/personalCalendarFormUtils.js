import format from 'date-fns/format';
import * as z from 'zod';

export const personalCalendarFormSchema = z.object({
  name: z.string().min(3, {
    message: 'Name must be at least 3 characters.',
  }),
  practitioner: z.string({
    required_error: 'Please select a practitioner.',
  }),
  days_of_week: z.array(z.number()).min(1, {
    message: 'At least one day of the week must be selected.',
  }),
  start_time: z.string({
    required_error: 'Please enter a start time.',
  }),
  end_time: z.string({
    required_error: 'Please enter an end time.',
  }),
  slot_duration: z.number({
    required_error: 'Please enter a slot duration.',
  }).min(5, {
    message: 'Slot duration must be at least 5 minutes.',
  }),
  active_from: z.date({
    required_error: 'Please select a start date.',
  }),
  active_to: z.date().optional(),
  is_active: z.boolean().default(true),
  template_name: z.string().max(120).optional().or(z.literal('')),
  practitioners: z.array(z.string().uuid()).optional(),
  breaks: z.array(z.object({
    start: z.string().min(1, 'Start time is required'),
    end: z.string().min(1, 'End time is required'),
  })).optional(),
});

export const personalCalendarDaysOfWeek = [
  { id: 0, label: 'Monday' },
  { id: 1, label: 'Tuesday' },
  { id: 2, label: 'Wednesday' },
  { id: 3, label: 'Thursday' },
  { id: 4, label: 'Friday' },
  { id: 5, label: 'Saturday' },
  { id: 6, label: 'Sunday' },
];

export const getPersonalCalendarDefaultValues = (
  initialData,
  shouldAutoFillPractitioner,
  currentUserPractitionerId
) => ({
  name: initialData?.name || '',
  practitioner: initialData?.practitioner || (
    shouldAutoFillPractitioner ? currentUserPractitionerId : ''
  ),
  days_of_week: initialData?.days_of_week || [],
  start_time: initialData?.start_time || '09:00',
  end_time: initialData?.end_time || '17:00',
  slot_duration: initialData?.slot_duration || 30,
  active_from: initialData?.active_from ? new Date(initialData.active_from) : new Date(),
  active_to: initialData?.active_to ? new Date(initialData.active_to) : undefined,
  is_active: initialData?.is_active ?? true,
  template_name: initialData?.template_name || '',
  practitioners: [],
  breaks: initialData?.breaks || [],
});

export const getPractitionerOptions = (practitioners) => {
  if (!Array.isArray(practitioners)) return [];

  return practitioners.map((practitioner) => {
    if (practitioner?.name) {
      return {
        label: practitioner.name,
        value: practitioner.id,
      };
    }

    if (practitioner.fhir_resource) {
      const name = practitioner.fhir_resource.name?.[0];
      const given = name?.given?.join(' ') || '';
      const family = name?.family || '';
      const displayName = `${family}, ${given}`.trim() || 'Unknown Practitioner';
      return {
        label: displayName,
        value: practitioner.local_data?.id || practitioner.fhir_resource.id,
      };
    }

    const user = practitioner.staff_details?.user_details;
    const role = user?.user_type
      ? `${user.user_type.charAt(0).toUpperCase()}${user.user_type.slice(1)}`
      : '';

    return {
      label: `${user?.first_name || ''} ${user?.last_name || ''} - ${role}`.replace(/\s+/g, ' ').trim(),
      value: practitioner.id,
    };
  });
};

export const buildAvailabilityRulePayload = (data, { canShareTemplate, isEditing }) => {
  const formattedData = {
    ...data,
    active_from: format(data.active_from, 'yyyy-MM-dd'),
    active_to: data.active_to ? format(data.active_to, 'yyyy-MM-dd') : null,
  };

  if (!canShareTemplate || isEditing) {
    delete formattedData.practitioners;
    delete formattedData.template_name;
    return formattedData;
  }

  const primaryPractitioner = formattedData.practitioner;
  const additional = Array.isArray(formattedData.practitioners)
    ? formattedData.practitioners.filter((id) => id && id !== primaryPractitioner)
    : [];

  if (additional.length === 0) {
    delete formattedData.practitioners;
    delete formattedData.template_name;
    return formattedData;
  }

  formattedData.practitioners = additional;
  formattedData.template_name = (formattedData.template_name || '').trim() || null;
  return formattedData;
};

export const getCreateAvailabilitySuccessMessage = (result) => {
  const createdCount = Number(result?.created_count || 0);
  if (createdCount > 1) {
    return `Personal calendar rule template applied to ${createdCount} practitioners`;
  }

  return 'Personal calendar rule created successfully';
};
