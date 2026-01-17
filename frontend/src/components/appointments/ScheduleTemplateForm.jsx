import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Combobox } from '@/components/ui/combobox';
import { Card, CardContent } from '@/components/ui/card';

import { createScheduleTemplate, updateScheduleTemplate } from '@/lib/api';

// Form validation schema
const formSchema = z.object({
  name: z.string().min(3, {
    message: "Name must be at least 3 characters.",
  }),
  practitioner: z.string({
    required_error: "Please select a practitioner.",
  }),
  is_active: z.boolean().default(true),
  time_slots: z.array(
    z.object({
      day_of_week: z.number({
        required_error: "Please select a day of the week.",
      }),
      start_time: z.string({
        required_error: "Please enter a start time.",
      }),
      end_time: z.string({
        required_error: "Please enter an end time.",
      }),
    })
  ).min(1, {
    message: "At least one time slot is required.",
  }),
});

const ScheduleTemplateForm = ({ initialData = null, onSuccess, practitioners = [] }) => {
  const [submitting, setSubmitting] = useState(false);
  const isEditing = !!initialData;

  // Initialize form with default values or initial data
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initialData?.name || '',
      practitioner: initialData?.practitioner || '',
      is_active: initialData?.is_active ?? true,
      time_slots: initialData?.time_slots?.length > 0 
        ? initialData.time_slots 
        : [{ day_of_week: 0, start_time: '09:00', end_time: '17:00' }],
    },
  });

  // Set up field array for time slots
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "time_slots",
  });

  // Handle form submission
  const onSubmit = async (data) => {
    setSubmitting(true);
    try {
      let result;

      if (isEditing) {
        // Update existing template
        result = await updateScheduleTemplate(initialData.id, data);
        toast.success("Schedule template updated successfully");
      } else {
        // Create new template
        result = await createScheduleTemplate(data);
        toast.success("Schedule template created successfully");
      }

      if (onSuccess) {
        onSuccess(result);
      }
    } catch (error) {
      console.error('Error saving schedule template:', error);
      toast.error(error.message || 'Failed to save schedule template');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Template Name */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Template Name</FormLabel>
              <FormControl>
                <Input 
                  placeholder="e.g., Dr. Smith Regular Hours" 
                  {...field} 
                  disabled={submitting}
                />
              </FormControl>
              <FormDescription>
                A descriptive name for this schedule template.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Practitioner Selection */}
        <FormField
          control={form.control}
          name="practitioner"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Practitioner</FormLabel>
              <FormControl>
                <Combobox
                  options={Array.isArray(practitioners) ? practitioners.map((practitioner) => ({
                    label: practitioner?.name || `${practitioner.staff_details?.user_details?.first_name || ''} ${practitioner.staff_details?.user_details?.last_name || ''}
                    - ${practitioner.staff_details?.user_details?.user_type?.charAt(0).toUpperCase() + practitioner.staff_details?.user_details?.user_type?.slice(1)}`.trim(),
                    value: practitioner.id
                  })) : []}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Select a practitioner"
                  emptyMessage="No practitioners found."
                  searchPlaceholder="Search practitioners..."
                  disabled={submitting || isEditing} // Can't change practitioner when editing
                  maxHeight="20rem"
                />
              </FormControl>
              <FormDescription>
                The practitioner this schedule applies to.
                {isEditing && " Practitioner cannot be changed after creation."}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Active Status */}
        <FormField
          control={form.control}
          name="is_active"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Active Status</FormLabel>
                <FormDescription>
                  Whether this template is active and can be used to generate schedules.
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={submitting}
                />
              </FormControl>
            </FormItem>
          )}
        />

        {/* Time Slots */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Time Slots</h3>
            <Button 
              type="button" 
              variant="outline" 
              size="sm" 
              onClick={() => append({ day_of_week: 0, start_time: '09:00', end_time: '17:00' })}
              disabled={submitting}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Time Slot
            </Button>
          </div>

          <FormDescription>
            Define the recurring time slots for this schedule template. Each slot represents a specific time period on a specific day of the week.
          </FormDescription>

          {fields.length === 0 && (
            <Card>
              <CardContent className="p-4 text-center text-muted-foreground">
                No time slots defined. Click "Add Time Slot" to create one.
              </CardContent>
            </Card>
          )}

          {fields.map((field, index) => (
            <Card key={field.id} className="overflow-hidden">
              <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Day of Week */}
                <FormField
                  control={form.control}
                  name={`time_slots.${index}.day_of_week`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Day of Week</FormLabel>
                      <Select
                        value={field.value.toString()}
                        onValueChange={(value) => field.onChange(parseInt(value))}
                        disabled={submitting}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select day" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="0">Monday</SelectItem>
                          <SelectItem value="1">Tuesday</SelectItem>
                          <SelectItem value="2">Wednesday</SelectItem>
                          <SelectItem value="3">Thursday</SelectItem>
                          <SelectItem value="4">Friday</SelectItem>
                          <SelectItem value="5">Saturday</SelectItem>
                          <SelectItem value="6">Sunday</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Start Time */}
                <FormField
                  control={form.control}
                  name={`time_slots.${index}.start_time`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Time</FormLabel>
                      <FormControl>
                        <Input
                          type="time"
                          {...field}
                          disabled={submitting}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* End Time */}
                <FormField
                  control={form.control}
                  name={`time_slots.${index}.end_time`}
                  render={({ field }) => (
                    <div className="flex items-end gap-2">
                      <FormItem className="flex-1">
                        <FormLabel>End Time</FormLabel>
                        <FormControl>
                          <Input
                            type="time"
                            {...field}
                            disabled={submitting}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        onClick={() => remove(index)}
                        disabled={submitting || fields.length <= 1}
                        className="mb-2"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Submit Button */}
        <div className="flex justify-end">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : isEditing ? 'Update Template' : 'Create Template'}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default ScheduleTemplateForm;
