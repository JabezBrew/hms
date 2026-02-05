import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useCreateTimeSlot, useUpdateTimeSlot } from '@/features/appointments/hooks/useAppointmentQueries';

// Day of week options
const DAYS_OF_WEEK = [
  { value: 0, label: 'Monday' },
  { value: 1, label: 'Tuesday' },
  { value: 2, label: 'Wednesday' },
  { value: 3, label: 'Thursday' },
  { value: 4, label: 'Friday' },
  { value: 5, label: 'Saturday' },
  { value: 6, label: 'Sunday' },
];

// Form validation schema
const formSchema = z.object({
  day_of_week: z.number({
    required_error: "Day of week is required",
  }),
  start_time: z.string({
    required_error: "Start time is required",
  }),
  end_time: z.string({
    required_error: "End time is required",
  }),
}).refine(data => {
  // Validate that end time is after start time
  const [startHours, startMinutes] = data.start_time.split(':').map(Number);
  const [endHours, endMinutes] = data.end_time.split(':').map(Number);

  const startTotalMinutes = startHours * 60 + startMinutes;
  const endTotalMinutes = endHours * 60 + endMinutes;

  return endTotalMinutes > startTotalMinutes;
}, {
  message: "End time must be after start time",
  path: ["end_time"],
});

const TimeSlotForm = ({ initialData = null, templateId, onSuccess }) => {
  const [submitting, setSubmitting] = useState(false);
  const isEditing = !!initialData;

  // Initialize form with default values or initial data
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      day_of_week: initialData?.day_of_week ?? 0,
      start_time: initialData?.start_time || '09:00',
      end_time: initialData?.end_time || '17:00',
    },
  });

  // Use React Query mutation hooks
  const createTimeSlotMutation = useCreateTimeSlot();
  const updateTimeSlotMutation = useUpdateTimeSlot();

  // Handle form submission
  const onSubmit = async (data) => {
    setSubmitting(true);

    // Add template ID to data
    const timeSlotData = {
      ...data,
      template: templateId,
    };

    try {
      if (isEditing) {
        // Update existing time slot using mutation
        updateTimeSlotMutation.mutate(
          { id: initialData.id, data: timeSlotData },
          {
            onSuccess: (result) => {
              toast.success("Time slot updated successfully");
              if (onSuccess) {
                onSuccess(result);
              }
            },
            onError: (error) => {
              console.error('Error updating time slot:', error);
              toast.error(error.message || 'Failed to update time slot');
            },
            onSettled: () => {
              setSubmitting(false);
            }
          }
        );
      } else {
        // Create new time slot using mutation
        createTimeSlotMutation.mutate(
          timeSlotData,
          {
            onSuccess: (result) => {
              toast.success("Time slot created successfully");
              if (onSuccess) {
                onSuccess(result);
              }
            },
            onError: (error) => {
              console.error('Error creating time slot:', error);
              toast.error(error.message || 'Failed to create time slot');
            },
            onSettled: () => {
              setSubmitting(false);
            }
          }
        );
      }
    } catch (error) {
      console.error('Error preparing time slot data:', error);
      toast.error(error.message || 'Failed to prepare time slot data');
      setSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Day of Week */}
        <FormField
          control={form.control}
          name="day_of_week"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Day of Week</FormLabel>
              <Select
                onValueChange={(value) => field.onChange(parseInt(value, 10))}
                value={field.value.toString()}
                disabled={submitting}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a day" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {DAYS_OF_WEEK.map((day) => (
                    <SelectItem key={day.value} value={day.value.toString()}>
                      {day.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                The day of the week for this time slot.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Start Time */}
        <FormField
          control={form.control}
          name="start_time"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Start Time</FormLabel>
              <div className="flex items-center">
                <FormControl>
                  <input
                    type="time"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    {...field}
                    disabled={submitting}
                  />
                </FormControl>
                <Clock className="ml-2 h-4 w-4 opacity-50" />
              </div>
              <FormDescription>
                The start time for this time slot.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* End Time */}
        <FormField
          control={form.control}
          name="end_time"
          render={({ field }) => (
            <FormItem>
              <FormLabel>End Time</FormLabel>
              <div className="flex items-center">
                <FormControl>
                  <input
                    type="time"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    {...field}
                    disabled={submitting}
                  />
                </FormControl>
                <Clock className="ml-2 h-4 w-4 opacity-50" />
              </div>
              <FormDescription>
                The end time for this time slot.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Submit Button */}
        <div className="flex justify-end">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : isEditing ? 'Update Time Slot' : 'Add Time Slot'}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default TimeSlotForm;
