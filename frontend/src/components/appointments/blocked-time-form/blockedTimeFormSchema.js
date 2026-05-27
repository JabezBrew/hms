import * as z from 'zod';

import { copyDate } from './currentLocalDay';

export const blockedTimeFormSchema = z.object({
  practitioner_id: z.string().min(1, 'Practitioner is required'),
  reason: z.string().min(1, 'Reason is required'),
  is_all_day: z.boolean().default(false),
  mode: z.enum(['single', 'range']).default('single'),
  date: z.date().optional(),
  start_date: z.date().optional(),
  end_date: z.date().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
}).refine((data) => {
  if (data.mode === 'single') {
    return !!data.date;
  }
  return !!data.start_date && !!data.end_date;
}, {
  message: 'Date selection is required',
  path: ['date'],
}).refine((data) => {
  if (data.is_all_day) return true;
  if (data.mode === 'single') {
    return !!data.start_time && !!data.end_time;
  }
  return true;
}, {
  message: 'Start and end times are required for partial day blocks',
  path: ['start_time'],
});

export function getBlockedTimeDefaultValues(initialData, todayStart) {
  return {
    practitioner_id: initialData?.practitioner || '',
    reason: initialData?.reason || '',
    is_all_day: initialData?.is_all_day || false,
    mode: initialData?.end_date && initialData.start_date !== initialData.end_date ? 'range' : 'single',
    date: initialData?.date ? new Date(initialData.date) : copyDate(todayStart),
    start_date: initialData?.start_date ? new Date(initialData.start_date) : copyDate(todayStart),
    end_date: initialData?.end_date ? new Date(initialData.end_date) : copyDate(todayStart),
    start_time: initialData?.start_time || '09:00',
    end_time: initialData?.end_time || '17:00',
  };
}
