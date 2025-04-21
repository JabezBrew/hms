import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { Plus, Trash2, CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useDebounce } from '@/hooks/use-debounce';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
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
import { SearchBar } from '@/components/ui/search-bar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

import { createRecurringSchedule, updateRecurringSchedule, searchPractitioners } from '@/lib/api';

// Form validation schema
const formSchema = z.object({
  name: z.string().min(3, {
    message: "Name must be at least 3 characters.",
  }),
  practitioner: z.string({
    required_error: "Please select a practitioner.",
  }),
  days_of_week: z.array(z.number()).min(1, {
    message: "At least one day of the week must be selected.",
  }),
  start_time: z.string({
    required_error: "Please enter a start time.",
  }),
  end_time: z.string({
    required_error: "Please enter an end time.",
  }),
  slot_duration: z.number({
    required_error: "Please enter a slot duration.",
  }).min(5, {
    message: "Slot duration must be at least 5 minutes.",
  }),
  active_from: z.date({
    required_error: "Please select a start date.",
  }),
  active_to: z.date().optional(),
  is_active: z.boolean().default(true),
});

const RecurringScheduleForm = ({ initialData = null, onSuccess }) => {
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [practitioners, setPractitioners] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const isEditing = !!initialData;

  // If editing, fetch the current practitioner to display
  useEffect(() => {
    if (isEditing && initialData?.practitioner) {
      const fetchPractitioner = async () => {
        try {
          // Search for the practitioner by ID to get their details
          const result = await searchPractitioners(initialData.practitioner);
          if (Array.isArray(result) && result.length > 0) {
            setPractitioners(result);
          }
        } catch (error) {
          console.error('Error fetching practitioner:', error);
        }
      };

      fetchPractitioner();
    }
  }, [isEditing, initialData]);

  // Search practitioners when query changes
  useEffect(() => {
    const searchForPractitioners = async () => {
      if (!debouncedSearchQuery || debouncedSearchQuery.length < 2) {
        return;
      }

      setIsLoading(true);
      try {
        const results = await searchPractitioners(debouncedSearchQuery);
        setPractitioners(Array.isArray(results) ? results : []);
      } catch (error) {
        console.error('Error searching practitioners:', error);
        toast.error('Failed to search practitioners');
      } finally {
        setIsLoading(false);
      }
    };

    searchForPractitioners();
  }, [debouncedSearchQuery]);

  // Days of week options
  const daysOfWeek = [
    { id: 0, label: 'Monday' },
    { id: 1, label: 'Tuesday' },
    { id: 2, label: 'Wednesday' },
    { id: 3, label: 'Thursday' },
    { id: 4, label: 'Friday' },
    { id: 5, label: 'Saturday' },
    { id: 6, label: 'Sunday' },
  ];

  // Initialize form with default values or initial data
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initialData?.name || '',
      practitioner: initialData?.practitioner || '',
      days_of_week: initialData?.days_of_week || [],
      start_time: initialData?.start_time || '09:00',
      end_time: initialData?.end_time || '17:00',
      slot_duration: initialData?.slot_duration || 30,
      active_from: initialData?.active_from ? new Date(initialData.active_from) : new Date(),
      active_to: initialData?.active_to ? new Date(initialData.active_to) : undefined,
      is_active: initialData?.is_active ?? true,
    },
  });

  // Handle form submission
  const onSubmit = async (data) => {
    setSubmitting(true);
    try {
      // Format dates for API
      const formattedData = {
        ...data,
        active_from: format(data.active_from, 'yyyy-MM-dd'),
        active_to: data.active_to ? format(data.active_to, 'yyyy-MM-dd') : null,
      };

      let result;

      if (isEditing) {
        // Update existing schedule
        result = await updateRecurringSchedule(initialData.id, formattedData);
        toast.success("Recurring schedule updated successfully");
      } else {
        // Create new schedule
        result = await createRecurringSchedule(formattedData);
        toast.success("Recurring schedule created successfully");
      }

      if (onSuccess) {
        onSuccess(result);
      }
    } catch (error) {
      console.error('Error saving recurring schedule:', error);
      toast.error(error.message || 'Failed to save recurring schedule');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Schedule Name */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Schedule Name</FormLabel>
              <FormControl>
                <Input 
                  placeholder="e.g., Dr. Smith Regular Hours" 
                  {...field} 
                  disabled={submitting}
                />
              </FormControl>
              <FormDescription>
                A descriptive name for this recurring schedule.
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
                <SearchBar
                  options={Array.isArray(practitioners) ? practitioners.map((practitioner) => {
                    // Handle both old and new response structures
                    if (practitioner.fhir_resource) {
                      // New structure with FHIR resource
                      const name = practitioner.fhir_resource.name?.[0];
                      const given = name?.given?.join(' ') || '';
                      const family = name?.family || '';
                      const displayName = `${family}, ${given}`.trim() || 'Unknown Practitioner';
                      return {
                        label: displayName,
                        value: practitioner.fhir_resource.id
                      };
                    } else {
                      // Old structure with staff_details
                      return {
                        label: `${practitioner.staff_details?.user_details?.first_name} ${practitioner.staff_details?.user_details?.last_name} - ${practitioner.staff_details?.user_details?.user_type?.charAt(0).toUpperCase() + practitioner.staff_details?.user_details?.user_type?.slice(1)}`.replace(/\s+/g, ' ').trim(),
                        value: practitioner.id
                      };
                    }
                  }) : []}
                  value={field.value}
                  onChange={field.onChange}
                  onInputChange={setSearchQuery}
                  placeholder="Select a practitioner"
                  emptyMessage={isLoading ? "Searching..." : "No practitioners found."}
                  searchPlaceholder="Search by name, employee ID, or license number..."
                  disabled={submitting || isEditing} // Can't change practitioner when editing
                  maxHeight="20rem"
                  isLoading={isLoading}
                />
              </FormControl>
              <FormDescription>
                The practitioner this schedule applies to. Search by name, employee ID, or license number.
                {isEditing && " Practitioner cannot be changed after creation."}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Days of Week */}
        <FormField
          control={form.control}
          name="days_of_week"
          render={() => (
            <FormItem>
              <FormLabel>Days of Week</FormLabel>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                {daysOfWeek.map((day) => (
                  <FormField
                    key={day.id}
                    control={form.control}
                    name="days_of_week"
                    render={({ field }) => {
                      return (
                        <FormItem
                          key={day.id}
                          className="flex flex-row items-center space-x-2 space-y-0"
                        >
                          <FormControl>
                            <Checkbox
                              checked={field.value?.includes(day.id)}
                              onCheckedChange={(checked) => {
                                return checked
                                  ? field.onChange([...field.value, day.id])
                                  : field.onChange(
                                      field.value?.filter(
                                        (value) => value !== day.id
                                      )
                                    );
                              }}
                              disabled={submitting}
                            />
                          </FormControl>
                          <FormLabel className="font-normal">
                            {day.label}
                          </FormLabel>
                        </FormItem>
                      );
                    }}
                  />
                ))}
              </div>
              <FormDescription>
                Select the days of the week when this schedule applies.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Time Range */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Start Time */}
          <FormField
            control={form.control}
            name="start_time"
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
            name="end_time"
            render={({ field }) => (
              <FormItem>
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
            )}
          />
        </div>

        {/* Slot Duration */}
        <FormField
          control={form.control}
          name="slot_duration"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Slot Duration (minutes)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={5}
                  step={5}
                  {...field}
                  onChange={(e) => field.onChange(parseInt(e.target.value))}
                  disabled={submitting}
                />
              </FormControl>
              <FormDescription>
                The duration of each appointment slot in minutes.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Date Range */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Active From */}
          <FormField
            control={form.control}
            name="active_from"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Active From</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant={"outline"}
                        className={cn(
                          "w-full pl-3 text-left font-normal",
                          !field.value && "text-muted-foreground"
                        )}
                        disabled={submitting}
                      >
                        {field.value ? (
                          format(field.value, "PPP")
                        ) : (
                          <span>Pick a date</span>
                        )}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FormDescription>
                  The date from which this schedule becomes active.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Active To */}
          <FormField
            control={form.control}
            name="active_to"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Active To (Optional)</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant={"outline"}
                        className={cn(
                          "w-full pl-3 text-left font-normal",
                          !field.value && "text-muted-foreground"
                        )}
                        disabled={submitting}
                      >
                        {field.value ? (
                          format(field.value, "PPP")
                        ) : (
                          <span>No end date</span>
                        )}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FormDescription>
                  Optional end date for this schedule. Leave blank for indefinite schedules.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Active Status */}
        <FormField
          control={form.control}
          name="is_active"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Active Status</FormLabel>
                <FormDescription>
                  Whether this schedule is active and can be used to generate slots.
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

        {/* Submit Button */}
        <div className="flex justify-end">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : isEditing ? 'Update Schedule' : 'Create Schedule'}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default RecurringScheduleForm;
