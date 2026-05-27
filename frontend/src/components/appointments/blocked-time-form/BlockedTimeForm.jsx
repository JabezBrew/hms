/* oxlint-disable react-doctor/prefer-useReducer -- Submission state is independent from React Hook Form field state. */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import format from 'date-fns/format';

import { Form } from '@/components/ui/form';
import { usePractitioners } from '@/features/staff/hooks';
import {
  useCreateBlockedTime,
  useBulkCreateBlockedTime,
  useUpdateBlockedTime,
} from '@/features/appointments/hooks/useAppointmentQueries';

import { BlockedTimeActions } from './BlockedTimeActions';
import { BlockedTimeAllDayField } from './BlockedTimeAllDayField';
import { BlockedTimeDateFields } from './BlockedTimeDateFields';
import { BlockedTimeModeField } from './BlockedTimeModeField';
import { BlockedTimePractitionerField } from './BlockedTimePractitionerField';
import { BlockedTimeReasonField } from './BlockedTimeReasonField';
import { BlockedTimeTimeFields } from './BlockedTimeTimeFields';
import { blockedTimeFormSchema, getBlockedTimeDefaultValues } from './blockedTimeFormSchema';
import { useCurrentLocalDayStart } from './currentLocalDay';

const BlockedTimeForm = ({ initialData, onSuccess, onCancel }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const todayStart = useCurrentLocalDayStart();

  const { data: practitioners = [] } = usePractitioners();
  const createBlockedTime = useCreateBlockedTime();
  const bulkCreateBlockedTime = useBulkCreateBlockedTime();
  const updateBlockedTime = useUpdateBlockedTime();

  const form = useForm({
    resolver: zodResolver(blockedTimeFormSchema),
    defaultValues: getBlockedTimeDefaultValues(initialData, todayStart),
  });

  const mode = form.watch('mode');
  const isAllDay = form.watch('is_all_day');

  const onSubmit = async (values) => {
    setIsSubmitting(true);
    try {
      if (initialData) {
        await updateBlockedTime.mutateAsync({
          id: initialData.id,
          data: {
            practitioner_id: values.practitioner_id,
            date: format(values.date, 'yyyy-MM-dd'),
            start_time: values.is_all_day ? null : values.start_time,
            end_time: values.is_all_day ? null : values.end_time,
            reason: values.reason,
            is_all_day: values.is_all_day,
          },
        });
      } else if (values.mode === 'range') {
        await bulkCreateBlockedTime.mutateAsync({
          practitioner_id: values.practitioner_id,
          start_date: format(values.start_date, 'yyyy-MM-dd'),
          end_date: format(values.end_date, 'yyyy-MM-dd'),
          reason: values.reason,
          is_all_day: true,
        });
      } else {
        await createBlockedTime.mutateAsync({
          practitioner_id: values.practitioner_id,
          date: format(values.date, 'yyyy-MM-dd'),
          start_time: values.is_all_day ? null : values.start_time,
          end_time: values.is_all_day ? null : values.end_time,
          reason: values.reason,
          is_all_day: values.is_all_day,
        });
      }
      onSuccess?.();
    } catch (error) {
      console.error('Failed to save blocked time:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <BlockedTimePractitionerField
          control={form.control}
          practitioners={practitioners}
          initialData={initialData}
        />

        {!initialData && <BlockedTimeModeField control={form.control} />}

        <BlockedTimeDateFields
          control={form.control}
          mode={mode}
          todayStart={todayStart}
        />

        {mode === 'single' && <BlockedTimeAllDayField control={form.control} />}

        {mode === 'single' && !isAllDay && <BlockedTimeTimeFields control={form.control} />}

        <BlockedTimeReasonField control={form.control} />

        <BlockedTimeActions
          initialData={initialData}
          isSubmitting={isSubmitting}
          onCancel={onCancel}
        />
      </form>
    </Form>
  );
};

export default BlockedTimeForm;
