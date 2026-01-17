import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import format from 'date-fns/format';
import addMinutes from 'date-fns/addMinutes';
import parseISO from 'date-fns/parseISO';

import { useNavigate } from 'react-router-dom';
import {toast} from 'sonner';
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
import { Input } from '@/components/ui/input';
import { cn, normalizeApiResults } from '@/lib/utils';
import { 
  fetchAppointmentTypes, 
  fetchAvailableSlots, 
  createAppointment,
  fetchPatient,
  searchPatients,
  searchPractitioners
} from '@/lib/api.js';
import { SearchBar } from "@/components/ui/search-bar";
import DoctorAvailability from './DoctorAvailability';

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
  const [patientSearchQuery, setPatientSearchQuery] = useState("");
  const [patients, setPatients] = useState([]);
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const debouncedPatientQuery = useDebounce(patientSearchQuery, 300);

  const [practitionerSearchQuery, setPractitionerSearchQuery] = useState("");
  const [practitioners, setPractitioners] = useState([]);
  const [isLoadingPractitioners, setIsLoadingPractitioners] = useState(false);
  const debouncedPractitionerQuery = useDebounce(practitionerSearchQuery, 300);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  // Initialize form with default values
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      patientId: "",
      practitionerId: "",
      appointmentTypeId: "",
      date: new Date(),
      slotId: "",
      startTime: "",
      endTime: "",
      description: "",
      comment: "",
    },
  });

  // Reset form with initialData when it changes (for edit mode)
  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      form.reset({
        patientId: initialData.patientId || "",
        practitionerId: initialData.practitionerId || "",
        appointmentTypeId: initialData.appointmentTypeId || "",
        date: initialData.date ? parseISO(initialData.date) : new Date(),
        slotId: initialData.slotId || "",
        startTime: initialData.startTime || "",
        endTime: initialData.endTime || "",
        description: initialData.description || "",
        comment: initialData.comment || "",
      });
    }
  }, [initialData, form]);

  // Watch form values for dependent fields
  const watchPractitionerId = form.watch("practitionerId");
  const watchDate = form.watch("date");
  const watchAppointmentTypeId = form.watch("appointmentTypeId");
  const watchSlotId = form.watch("slotId");

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

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      try {
        // If we have initialData with patientId or practitionerId, fetch those
        if (initialData.patientId) {
          try {
            const patientData = await fetchPatient(initialData.patientId);
            setPatients([patientData]);
          } catch (error) {
            console.error('Error loading initial patient:', error);
          }
        }

        if (initialData.practitionerId) {
          try {
            // Search for the practitioner by ID to get their details
            // Using doctorsOnly=true since appointments are only with doctors
            const result = await searchPractitioners(initialData.practitionerId, true);
            if (Array.isArray(result) && result.length > 0) {
              setPractitioners(result);
            }
          } catch (error) {
            console.error('Error loading initial practitioner:', error);
          }
        }
      } catch (error) {
        console.error('Error loading initial data:', error);
        toast.error('Failed to load initial data');
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, [initialData.patientId, initialData.practitionerId]);

  // Search for patients when query changes
  useEffect(() => {
    const searchForPatients = async () => {
      if (!debouncedPatientQuery || debouncedPatientQuery.length < 2) {
        setPatients([]);
        return;
      }

      setIsLoadingPatients(true);
      try {
        const response = await searchPatients(debouncedPatientQuery);
        setPatients(normalizeApiResults(response));
      } catch (error) {
        console.error('Error searching patients:', error);
        toast.error('Failed to search patients');
        setPatients([]);
      } finally {
        setIsLoadingPatients(false);
      }
    };

    searchForPatients();
  }, [debouncedPatientQuery]);

  // Search for practitioners (doctors only) when query changes
  useEffect(() => {
    const searchForPractitioners = async () => {
      if (!debouncedPractitionerQuery || debouncedPractitionerQuery.length < 2) {
        return;
      }

      setIsLoadingPractitioners(true);
      try {
        // Using doctorsOnly=true since appointments are only with doctors
        const results = await searchPractitioners(debouncedPractitionerQuery, true);
        setPractitioners(Array.isArray(results) ? results : []);
      } catch (error) {
        console.error('Error searching practitioners:', error);
        toast.error('Failed to search practitioners');
      } finally {
        setIsLoadingPractitioners(false);
      }
    };

    searchForPractitioners();
  }, [debouncedPractitionerQuery]);

  // We no longer need to load available slots here as the DoctorAvailability component handles this
  // This effect is kept for reference but is now empty
  useEffect(() => {
    // The slot loading is now handled by the DoctorAvailability component
  }, [watchPractitionerId, watchDate, watchAppointmentTypeId]);

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

        // We don't need to find the selected slot here as we're using the date from the form
        // which is set when a slot is selected in the DoctorAvailability component
        // The backend will handle getting the start and end times from the slot
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
              <FormControl>
                <SearchBar
                    options={Array.isArray(patients) ? patients.map((patient) => {
                      let name = "Unknown Patient";
                      let id = patient?.id || "";

                      // Check for simple name field first (from search API)
                      if (patient?.name) {
                        name = patient.name;
                      }
                      // Check for FHIR resource format
                      else if (patient?.fhir_resource?.name?.[0]) {
                        const given = patient.fhir_resource.name[0].given?.join(' ') || "";
                        const family = patient.fhir_resource.name[0].family || "";
                        name = `${family}, ${given}`.trim() || "Unknown Patient";
                        id = patient.fhir_resource.id;
                      }
                      // Then check for local_data
                      else if (patient?.local_data?.user_details) {
                        name = `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim() || "Unknown Patient";
                        id = patient.local_data.id;
                      }

                      return {
                        label: name,
                        value: id
                      };
                    }) : []}
                  value={field.value}
                  onChange={field.onChange}
                  onInputChange={setPatientSearchQuery}
                  placeholder="Search for a patient"
                  emptyMessage={isLoadingPatients ? "Searching..." : "No patients found."}
                  searchPlaceholder="Search by name, MRN, or NHIS ID..."
                  disabled={submitting}
                  maxHeight="20rem"
                  isLoading={isLoadingPatients}
                />
              </FormControl>
              <FormDescription>
                Search for a patient by name, medical record number (MRN), or NHIS ID.
              </FormDescription>
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
                  <FormControl>
                    <SearchBar
                        options={Array.isArray(practitioners) ? practitioners.map((practitioner) => {
                          // Check for simple name field first (from search API)
                          if (practitioner?.name) {
                            return {
                              label: practitioner.name,
                              value: practitioner.id
                            };
                          } else if (practitioner.fhir_resource) {
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
                              label: `${practitioner.staff_details?.user_details?.first_name} ${practitioner.staff_details?.user_details?.last_name} - ${practitioner.staff_details?.user_details?.user_type === 'doctor' ? 'Doctor' : practitioner.staff_details?.user_details?.user_type}`.replace(/\s+/g, ' ').trim(),
                              value: practitioner.id
                            };
                          }
                        }) : []}
                        value={field.value}
                        onChange={field.onChange}
                        onInputChange={setPractitionerSearchQuery}
                        placeholder="Search for a doctor"
                        emptyMessage={isLoadingPractitioners ? "Searching..." : "No doctors found."}
                        searchPlaceholder="Search by name, employee ID, or license number..."
                        disabled={submitting}
                        maxHeight="20rem"
                        isLoading={isLoadingPractitioners}
                    />
                  </FormControl>
                  <FormDescription>
                    Search for a doctor by name, employee ID, or license number. Only doctors can be selected for appointments.
                  </FormDescription>
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
                value={field.value}
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

        {/* Doctor Availability Calendar and Time Slots */}
        {watchPractitionerId && (
          <FormField
            control={form.control}
            name="slotId"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <DoctorAvailability
                    practitionerId={watchPractitionerId}
                    appointmentTypeId={watchAppointmentTypeId}
                    selectedSlotId={field.value}
                    onSlotSelect={(slot) => {
                      field.onChange(slot.id);
                      // Update the date field to match the slot's date
                      if (slot.start) {
                        const slotDate = new Date(slot.start);
                        form.setValue('date', slotDate);

                        // Also update the start and end time fields for backward compatibility
                        if (slot.start) form.setValue('startTime', format(new Date(slot.start), 'HH:mm'));
                        if (slot.end) form.setValue('endTime', format(new Date(slot.end), 'HH:mm'));
                      }
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
