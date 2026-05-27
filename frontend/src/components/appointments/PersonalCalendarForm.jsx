/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useState, useEffect, useMemo } from 'react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import format from 'date-fns/format';

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Switch } from '@/components/ui/switch';
import { SearchBar } from '@/components/ui/search-bar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { TimePicker } from '@/components/ui/time-picker';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';

import {
  useCreateAvailabilityRule,
  useUpdateAvailabilityRule
} from '@/features/appointments/hooks/useAppointmentQueries';
import {
  useSearchPractitioners
} from '@/features/staff/hooks';
import { previewSlots } from '@/features/appointments/api';

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
  template_name: z.string().max(120).optional().or(z.literal('')),
  practitioners: z.array(z.string().uuid()).optional(),
  breaks: z.array(z.object({
    start: z.string().min(1, "Start time is required"),
    end: z.string().min(1, "End time is required"),
  })).optional(),
});

const PersonalCalendarForm = ({ initialData = null, onSuccess }) => {
  const { user } = useAuth();
  const isDoctor = user?.role === 'doctor';
  const isAdmin = user?.role === 'admin';
  const currentUserPractitionerId = user?.practitionerId;
  const currentUserName = user ? `${user.firstName} ${user.lastName}` : '';
  const canShareTemplate = isAdmin && !initialData;

  const [submitting, setSubmitting] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [selectedSharedPractitioner, setSelectedSharedPractitioner] = useState(null);
  const isEditing = !!initialData;

  // Determine if practitioner should be auto-filled (doctor creating their own rule)
  const shouldAutoFillPractitioner = isDoctor && currentUserPractitionerId && !isEditing;

  // Use React Query hooks for data fetching - only enable search when not auto-filling
  const {
    data: practitioners = [],
    isLoading,
    isError: isPractitionersError,
    error: practitionersError,
    setSearchTerm
  } = useSearchPractitioners(false, {
    minLength: 2
  });

  // Create and update mutations
  const createAvailabilityRuleMutation = useCreateAvailabilityRule();
  const updateAvailabilityRuleMutation = useUpdateAvailabilityRule();

  // Show error toast if query fails
  useEffect(() => {
    if (isPractitionersError) {
      toast.error(practitionersError?.message || 'Failed to search practitioners');
      console.error('Error searching practitioners:', practitionersError);
    }
  }, [isPractitionersError, practitionersError]);

  // Set search term when editing to load the current practitioner
  useEffect(() => {
    if (isEditing && initialData?.practitioner_name) {
      // Set the search term to the practitioner name to trigger a search
      setSearchTerm(initialData.practitioner_name);
    }
  }, [isEditing, initialData, setSearchTerm]);

  const practitionerOptions = useMemo(() => {
    if (!Array.isArray(practitioners)) return [];
    return practitioners.map((practitioner) => {
      if (practitioner?.name) {
        return {
          label: practitioner.name,
          value: practitioner.id
        };
      }
      if (practitioner.fhir_resource) {
        const name = practitioner.fhir_resource.name?.[0];
        const given = name?.given?.join(' ') || '';
        const family = name?.family || '';
        const displayName = `${family}, ${given}`.trim() || 'Unknown Practitioner';
        return {
          label: displayName,
          value: practitioner.local_data?.id || practitioner.fhir_resource.id
        };
      }
      return {
        label: `${practitioner.staff_details?.user_details?.first_name} ${practitioner.staff_details?.user_details?.last_name} - ${practitioner.staff_details?.user_details?.user_type?.charAt(0).toUpperCase() + practitioner.staff_details?.user_details?.user_type?.slice(1)}`.replace(/\s+/g, ' ').trim(),
        value: practitioner.id
      };
    });
  }, [practitioners]);

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
  // Auto-fill practitioner for doctors creating their own rule
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initialData?.name || '',
      practitioner: initialData?.practitioner || (shouldAutoFillPractitioner ? currentUserPractitionerId : ''),
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
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "breaks",
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

  const addSharedPractitioner = () => {
    if (!selectedSharedPractitioner) return;
    const current = form.getValues('practitioners') || [];
    if (!current.includes(selectedSharedPractitioner)) {
      form.setValue('practitioners', [...current, selectedSharedPractitioner], { shouldValidate: true });
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

    // Validate required fields for preview
    if (!values.start_time || !values.end_time || !values.slot_duration) {
      toast.error("Please fill in start time, end time, and slot duration to preview slots.");
      return;
    }

    setIsPreviewLoading(true);
    try {
      const result = await previewSlots({
        start_time: values.start_time,
        end_time: values.end_time,
        slot_duration: values.slot_duration,
        breaks: values.breaks || []
      });
      setPreviewData(result.slots);
      setIsPreviewOpen(true);
    } catch (error) {
      console.error('Error previewing slots:', error);
      toast.error("Failed to generate preview.");
    } finally {
      setIsPreviewLoading(false);
    }
  };

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

      if (!canShareTemplate || isEditing) {
        delete formattedData.practitioners;
        delete formattedData.template_name;
      } else {
        const primaryPractitioner = formattedData.practitioner;
        const additional = Array.isArray(formattedData.practitioners)
          ? formattedData.practitioners.filter((id) => id && id !== primaryPractitioner)
          : [];
        if (additional.length > 0) {
          formattedData.practitioners = additional;
          formattedData.template_name = (formattedData.template_name || '').trim() || null;
        } else {
          delete formattedData.practitioners;
          delete formattedData.template_name;
        }
      }

      if (isEditing) {
        // Update existing rule using mutation
        updateAvailabilityRuleMutation.mutate(
          { id: initialData.id, data: formattedData },
          {
            onSuccess: (result) => {
              toast.success("Personal calendar rule updated successfully");
              if (onSuccess) {
                onSuccess(result);
              }
            },
            onError: (error) => {
              console.error('Error updating personal calendar rule:', error);
              toast.error(error.message || 'Failed to update personal calendar rule');
            },
            onSettled: () => {
              setSubmitting(false);
            }
          }
        );
      } else {
        // Create new rule using mutation
        createAvailabilityRuleMutation.mutate(
          formattedData,
          {
            onSuccess: (result) => {
              const createdCount = Number(result?.created_count || 0);
              if (createdCount > 1) {
                toast.success(`Personal calendar rule template applied to ${createdCount} practitioners`);
              } else {
                toast.success("Personal calendar rule created successfully");
              }
              if (onSuccess) {
                onSuccess(result);
              }
            },
            onError: (error) => {
              console.error('Error creating personal calendar rule:', error);
              toast.error(error.message || 'Failed to create personal calendar rule');
            },
            onSettled: () => {
              setSubmitting(false);
            }
          }
        );
      }
    } catch (error) {
      console.error('Error preparing personal calendar rule data:', error);
      toast.error(error.message || 'Failed to prepare personal calendar rule data');
      setSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* Rule Name */}
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

        {/* Practitioner Selection - Show read-only display for doctors creating their own rule */}
        {shouldAutoFillPractitioner ? (
          <FormItem>
            <FormLabel className="font-heading text-sm font-medium">Practitioner</FormLabel>
            <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
              <div className="flex size-8 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <User className="size-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-sm font-medium truncate">{currentUserName}</p>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Your Calendar</p>
              </div>
            </div>
            <FormDescription className="text-xs text-muted-foreground">
              This personal calendar rule will be created for you.
            </FormDescription>
          </FormItem>
        ) : (
          <FormField
            control={form.control}
            name="practitioner"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-heading text-sm font-medium">Practitioner</FormLabel>
                <FormControl>
                  <SearchBar
                    options={practitionerOptions}
                    value={field.value}
                    onChange={field.onChange}
                    onInputChange={setSearchTerm}
                    placeholder="Select a practitioner"
                    emptyMessage={isLoading ? "Searching..." : "No practitioners found."}
                    searchPlaceholder="Search by name, employee ID, or license number..."
                    disabled={submitting || isEditing} // Can't change practitioner when editing
                    maxHeight="20rem"
                    isLoading={isLoading}
                  />
                </FormControl>
                <FormDescription className="text-xs text-muted-foreground">
                  The practitioner this rule applies to. Search by name, employee ID, or license number.
                  {isEditing && " Practitioner cannot be changed after creation."}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {canShareTemplate && (
          <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
            <div className="space-y-1">
              <h4 className="font-heading text-sm font-medium">Share As Template</h4>
              <p className="text-xs text-muted-foreground">
                Apply this same personal calendar rule to multiple practitioners in one save.
              </p>
            </div>

            <FormField
              control={form.control}
              name="template_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-heading text-xs font-medium">Template Name (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Internal Medicine Morning Clinic"
                      className="font-mono text-xs"
                      {...field}
                      disabled={submitting}
                    />
                  </FormControl>
                  <FormDescription className="text-xs text-muted-foreground">
                    Used to label the shared calendar group.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <FormLabel className="font-heading text-xs font-medium">Additional Practitioners</FormLabel>
              <div className="flex gap-2">
                <SearchBar
                  options={availableSharedPractitionerOptions}
                  value={selectedSharedPractitioner}
                  onChange={setSelectedSharedPractitioner}
                  onInputChange={setSearchTerm}
                  placeholder="Search to add practitioner"
                  emptyMessage={isLoading ? "Searching..." : "No practitioners found."}
                  searchPlaceholder="Search by name, employee ID, or license number..."
                  disabled={submitting}
                  maxHeight="16rem"
                  isLoading={isLoading}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="font-mono text-xs whitespace-nowrap"
                  onClick={addSharedPractitioner}
                  disabled={!selectedSharedPractitioner || submitting}
                >
                  Add
                </Button>
              </div>

              {selectedSharedPractitioners.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {selectedSharedPractitioners.map((practitionerId) => {
                    const option = selectedSharedOptionMap.get(practitionerId);
                    return (
                      <span
                        key={practitionerId}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 font-mono text-[10px]"
                      >
                        <span className="max-w-[220px] truncate">{option?.label || practitionerId}</span>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => removeSharedPractitioner(practitionerId)}
                          aria-label="Remove practitioner"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No additional practitioners selected. This will create a single rule.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Days of Week */}
        <FormField
          control={form.control}
          name="days_of_week"
          render={({ field }) => {
            const allDayIds = daysOfWeek.map(d => d.id);
            const weekdayIds = [0, 1, 2, 3, 4]; // Mon-Fri
            const allSelected = allDayIds.every(id => field.value?.includes(id));
            const weekdaysSelected = weekdayIds.every(id => field.value?.includes(id));

            return (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel className="font-heading text-sm font-medium">Days of Week</FormLabel>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 font-mono text-[10px]"
                      onClick={() => field.onChange(weekdaysSelected ? [] : weekdayIds)}
                      disabled={submitting}
                    >
                      {weekdaysSelected ? 'Clear' : 'Weekdays'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 font-mono text-[10px]"
                      onClick={() => field.onChange(allSelected ? [] : allDayIds)}
                      disabled={submitting}
                    >
                      {allSelected ? 'None' : 'All'}
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 mt-2">
                  {daysOfWeek.map((day) => {
                    const isChecked = field.value?.includes(day.id);
                    return (
                      <label
                        key={day.id}
                        className={cn(
                          "flex items-center justify-center rounded-md border px-2 py-2 cursor-pointer transition-colors text-center",
                          isChecked
                            ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                            : "border-border hover:bg-muted/50"
                        )}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Repeat on ${day.label}`}
                          className="sr-only"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              field.onChange([...field.value, day.id]);
                            } else {
                              field.onChange(field.value?.filter(v => v !== day.id));
                            }
                          }}
                          disabled={submitting}
                        />
                        <span className={cn(
                          "font-mono text-xs",
                          isChecked ? "text-amber-700 dark:text-amber-400 font-medium" : "text-muted-foreground"
                        )}>
                          {day.label.slice(0, 3)}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <FormDescription className="text-xs text-muted-foreground">
                  Select the days of the week when this rule applies.
                </FormDescription>
                <FormMessage />
              </FormItem>
            );
          }}
        />

        {/* Time Range */}
        <div className="grid grid-cols-2 gap-4">
          {/* Start Time */}
          <FormField
            control={form.control}
            name="start_time"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-heading text-sm font-medium">Start Time</FormLabel>
                <FormControl>
                  <TimePicker
                    value={field.value}
                    onChange={field.onChange}
                    disabled={submitting}
                    placeholder="Select start time"
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
                <FormLabel className="font-heading text-sm font-medium">End Time</FormLabel>
                <FormControl>
                  <TimePicker
                    value={field.value}
                    onChange={field.onChange}
                    disabled={submitting}
                    placeholder="Select end time"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Breaks Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <FormLabel className="font-heading text-sm font-medium">Breaks</FormLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="font-mono text-xs h-7"
              onClick={() => append({ start: "12:00", end: "13:00" })}
            >
              <Plus className="mr-1.5 size-3.5" />
              Add Break
            </Button>
          </div>

          {fields.length === 0 && (
            <p className="text-xs text-muted-foreground italic py-2">No breaks defined.</p>
          )}

          <div className="space-y-2">
            {fields.map((field, index) => (
              <div key={field.id} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
                <FormField
                  control={form.control}
                  name={`breaks.${index}.start`}
                  render={({ field }) => (
                    <FormItem className="flex-1 space-y-0">
                      <FormControl>
                        <TimePicker
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Start"
                          className="h-8"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <span className="text-muted-foreground text-xs">to</span>
                <FormField
                  control={form.control}
                  name={`breaks.${index}.end`}
                  render={({ field }) => (
                    <FormItem className="flex-1 space-y-0">
                      <FormControl>
                        <TimePicker
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="End"
                          className="h-8"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                  onClick={() => remove(index)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Slot Duration */}
        <FormField
          control={form.control}
          name="slot_duration"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-heading text-sm font-medium">Slot Duration</FormLabel>
              <div className="flex items-center gap-2">
                <FormControl>
                  <Input
                    type="number"
                    min={5}
                    step={5}
                    className="font-mono text-sm w-24"
                    {...field}
                    onChange={(e) => field.onChange(parseInt(e.target.value))}
                    disabled={submitting}
                  />
                </FormControl>
                <span className="font-mono text-xs text-muted-foreground">minutes</span>
              </div>
              <FormDescription className="text-xs text-muted-foreground">
                The duration of each appointment slot.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Date Range */}
        <div className="grid grid-cols-2 gap-4">
          {/* Active From */}
          <FormField
            control={form.control}
            name="active_from"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel className="font-heading text-sm font-medium">Active From</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full pl-3 text-left font-mono text-sm",
                          !field.value && "text-muted-foreground"
                        )}
                        disabled={submitting}
                      >
                        {field.value ? (
                          format(field.value, "PPP")
                        ) : (
                          <span>Pick a date</span>
                        )}
                        <CalendarIcon className="ml-auto size-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 z-[400]" align="start" side="bottom" avoidCollisions>
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FormDescription className="text-xs text-muted-foreground">
                  When this rule becomes active.
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
                <FormLabel className="font-heading text-sm font-medium">Active To</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full pl-3 text-left font-mono text-sm",
                          !field.value && "text-muted-foreground"
                        )}
                        disabled={submitting}
                      >
                        {field.value ? (
                          format(field.value, "PPP")
                        ) : (
                          <span>No end date</span>
                        )}
                        <CalendarIcon className="ml-auto size-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 z-[400]" align="start" side="bottom" avoidCollisions>
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FormDescription className="text-xs text-muted-foreground">
                  Optional. Leave blank for indefinite.
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
            <FormItem className="flex flex-row items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-3">
              <div className="space-y-0.5">
                <FormLabel className="font-heading text-sm font-medium">Active Status</FormLabel>
                <FormDescription className="text-xs text-muted-foreground">
                  Enable to generate appointment slots.
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

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="font-mono text-xs"
                onClick={handlePreview}
                disabled={isPreviewLoading}
              >
                {isPreviewLoading ? (
                  <>Generating…</>
                ) : (
                  <>
                    <Eye className="mr-1.5 size-3.5" />
                    Preview Slots
                  </>
                )}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] z-[300]">
              <DialogHeader>
                <DialogTitle className="font-display text-lg">Slot Preview</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Preview of slots generated based on current settings (for a single day).
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[300px] overflow-y-auto pr-2">
                {previewData && previewData.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {previewData.map((slot) => (
                      <div key={`${slot.start}-${slot.end}`} className="font-mono text-xs bg-muted/50 px-2 py-1.5 rounded text-center border border-border">
                        {slot.start} - {slot.end}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-xs text-muted-foreground">
                    No slots generated. Check your time range and breaks.
                  </div>
                )}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mt-2">
                Total slots: {previewData?.length || 0}
              </div>
            </DialogContent>
          </Dialog>

          <Button
            type="submit"
            disabled={submitting}
            className="bg-amber-600 hover:bg-amber-700 font-mono text-xs"
          >
            {submitting ? 'Saving...' : isEditing ? 'Update Rule' : 'Create Rule'}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default PersonalCalendarForm;
