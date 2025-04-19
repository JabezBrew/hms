import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, addMinutes, parseISO } from 'date-fns';
import { CalendarIcon, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {toast} from 'sonner';

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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { 
  fetchAppointmentTypes, 
  fetchAvailableSlots, 
  createAppointment,
  fetchPatients,
  fetchPractitioners
} from '@/lib/api';

// Form validation schema
const formSchema = z.object({
  patientId: z.string({
    required_error: "Please select a patient",
  }),
  practitionerId: z.string({
    required_error: "Please select a practitioner",
  }),
  appointmentTypeId: z.string({
    required_error: "Please select an appointment type",
  }),
  date: z.date({
    required_error: "Please select a date",
  }),
  slotId: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  description: z.string().optional(),
  comment: z.string().optional(),
});

const AppointmentForm = ({ initialData = {}, onSuccess }) => {
  const [appointmentTypes, setAppointmentTypes] = useState([]);
  const [patients, setPatients] = useState([]);
  const [practitioners, setPractitioners] = useState([]);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  // Initialize form with default values
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      patientId: initialData.patientId || "",
      practitionerId: initialData.practitionerId || "",
      appointmentTypeId: initialData.appointmentTypeId || "",
      date: initialData.date ? parseISO(initialData.date) : new Date(),
      slotId: initialData.slotId || "",
      startTime: initialData.startTime || "",
      endTime: initialData.endTime || "",
      description: initialData.description || "",
      comment: initialData.comment || "",
    },
  });

  // Watch form values for dependent fields
  const watchPractitionerId = form.watch("practitionerId");
  const watchDate = form.watch("date");
  const watchAppointmentTypeId = form.watch("appointmentTypeId");

  // Load appointment types
  useEffect(() => {
    const loadAppointmentTypes = async () => {
      try {
        const data = await fetchAppointmentTypes();
        setAppointmentTypes(data);
      } catch (error) {
        console.error('Error loading appointment types:', error);
        toast.error('Failed to load appointment types');
      }
    };

    loadAppointmentTypes();
  }, [toast]);

  // Load patients and practitioners
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [patientsData, practitionersData] = await Promise.all([
          fetchPatients(),
          fetchPractitioners()
        ]);

        setPatients(patientsData);
        setPractitioners(practitionersData);
      } catch (error) {
        console.error('Error loading data:', error);
        toast.error('Failed to load required data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [toast]);

  // Load available slots when practitioner, date, or appointment type changes
  useEffect(() => {
    const loadAvailableSlots = async () => {
      if (!watchPractitionerId || !watchDate) return;

      try {
        const formattedDate = format(watchDate, 'yyyy-MM-dd');
        const params = new URLSearchParams({
          practitioner_id: watchPractitionerId,
          start_date: formattedDate,
          end_date: formattedDate,
        });

        if (watchAppointmentTypeId) {
          params.append('appointment_type_id', watchAppointmentTypeId);
        }

        const slots = await fetchAvailableSlots(params);
        setAvailableSlots(slots);
      } catch (error) {
        console.error('Error loading available slots:', error);
        toast.error('Failed to load available slots');
      }
    };

    if (watchPractitionerId && watchDate) {
      loadAvailableSlots();
    } else {
      setAvailableSlots([]);
    }
  }, [watchPractitionerId, watchDate, watchAppointmentTypeId, toast]);

  // Handle form submission
  const onSubmit = async (data) => {
    setSubmitting(true);
    try {
      // Format the data for the API
      const appointmentData = {
        patient_id: data.patientId,
        practitioner_id: data.practitionerId,
        appointment_type_id: data.appointmentTypeId,
        description: data.description,
        comment: data.comment,
      };

      // If a slot is selected, use it
      if (data.slotId) {
        appointmentData.slot_id = data.slotId;

        // Find the selected slot to get its start and end times
        const selectedSlot = availableSlots.find(slot => slot.id === data.slotId);
        if (selectedSlot) {
          appointmentData.start_time = selectedSlot.start;
          appointmentData.end_time = selectedSlot.end;
        }
      } else if (data.startTime) {
        // If no slot but start time is provided, construct the datetime
        const [hours, minutes] = data.startTime.split(':').map(Number);
        const startDateTime = new Date(data.date);
        startDateTime.setHours(hours, minutes, 0, 0);
        appointmentData.start_time = startDateTime.toISOString();

        // If end time is provided, use it; otherwise, default to 30 minutes
        if (data.endTime) {
          const [endHours, endMinutes] = data.endTime.split(':').map(Number);
          const endDateTime = new Date(data.date);
          endDateTime.setHours(endHours, endMinutes, 0, 0);
          appointmentData.end_time = endDateTime.toISOString();
        } else {
          // Default to 30 minutes if no end time and no appointment type
          const selectedType = appointmentTypes.find(type => type.id === data.appointmentTypeId);
          const duration = selectedType ? selectedType.duration_minutes : 30;
          appointmentData.end_time = addMinutes(new Date(appointmentData.start_time), duration).toISOString();
        }
      } else {
        toast.error('Please select a time slot or specify a start time');
        setSubmitting(false);
        return;
      }

      // Create the appointment
      const result = await createAppointment(appointmentData);

      toast.success('Appointment created successfully');

      // Call onSuccess callback or navigate
      if (onSuccess) {
        onSuccess(result);
      } else {
        navigate('/appointments');
      }
    } catch (error) {
      console.error('Error creating appointment:', error);
      toast.error(error.message || 'Failed to create appointment');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Patient Selection */}
        <FormField
          control={form.control}
          name="patientId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Patient</FormLabel>
              <Select 
                onValueChange={field.onChange} 
                defaultValue={field.value}
                disabled={submitting}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a patient" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Array.isArray(patients) ? patients.map((patient) => (
                    <SelectItem key={patient.id} value={patient.id}>
                      {patient.name?.[0]?.family}, {patient.name?.[0]?.given?.join(' ')}
                    </SelectItem>
                  )) : <SelectItem value="no_patients">No patients available</SelectItem>}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Practitioner Selection */}
        <FormField
          control={form.control}
          name="practitionerId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Practitioner</FormLabel>
              <Select 
                onValueChange={field.onChange} 
                defaultValue={field.value}
                disabled={submitting}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a practitioner" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Array.isArray(practitioners) ? practitioners.map((practitioner) => (
                    <SelectItem key={practitioner.id} value={practitioner.id}>
                      {practitioner.name?.[0]?.family}, {practitioner.name?.[0]?.given?.join(' ')}
                    </SelectItem>
                  )) : <SelectItem value="no_practitioners">No practitioners available</SelectItem>}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Appointment Type Selection */}
        <FormField
          control={form.control}
          name="appointmentTypeId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Appointment Type</FormLabel>
              <Select 
                onValueChange={field.onChange} 
                defaultValue={field.value}
                disabled={submitting}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an appointment type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Array.isArray(appointmentTypes) ? appointmentTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name} ({type.duration_minutes} min)
                    </SelectItem>
                  )) : <SelectItem value="no_appointment_types">No appointment types available</SelectItem>}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Date Selection */}
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Date</FormLabel>
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
                    disabled={(date) => date < new Date()}
                    initialFocus={true}
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Available Slots */}
        {watchPractitionerId && watchDate && availableSlots.length > 0 && (
          <FormField
            control={form.control}
            name="slotId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Available Time Slots</FormLabel>
                <Select 
                  onValueChange={field.onChange} 
                  defaultValue={field.value}
                  disabled={submitting}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a time slot" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {availableSlots.map((slot) => {
                      const start = parseISO(slot.start);
                      const end = parseISO(slot.end);
                      return (
                        <SelectItem key={slot.id} value={slot.id}>
                          {format(start, 'h:mm a')} - {format(end, 'h:mm a')}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Select from available time slots or specify a custom time below
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Custom Time (if no slots available or for more flexibility) */}
        {watchPractitionerId && watchDate && (
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="startTime"
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
                    Specify a custom start time
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="endTime"
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
                    Optional: Will default to appointment type duration
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* Description */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Brief description of the appointment"
                  className="resize-none"
                  {...field}
                  disabled={submitting}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Comments */}
        <FormField
          control={form.control}
          name="comment"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Comments</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Additional comments or notes"
                  className="resize-none"
                  {...field}
                  disabled={submitting}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end space-x-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/appointments')}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Appointment'}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default AppointmentForm;
