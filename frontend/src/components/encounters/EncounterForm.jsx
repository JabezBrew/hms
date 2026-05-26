import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchBar } from '@/components/ui/search-bar';
import format from 'date-fns/format';
import DoctorAvailabilityCalendar from '@/components/appointments/DoctorAvailabilityCalendar';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useCreateEncounter,
  useUpdateEncounter,
  useEncounter,
  useSearchPatientsForEncounter,
  useSearchPractitioners
} from '@/features/encounters/hooks/useEncounterQueries';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

// Form validation schema
const legacyEncounterFormSchema = z.object({
  patient_id: z.string().min(1, { message: "Patient is required" }),
  practitioner_id: z.string().min(1, { message: "Practitioner is required" }),
  encounter_type: z.string().min(1, { message: "Encounter type is required" }),
  status: z.string().min(1, { message: "Status is required" }),
  reason: z.string().min(1, { message: "Reason for visit is required" }),
  service_type: z.string().min(1, { message: "Service type is required" }),
  start_time: z.date({ required_error: "Start time is required" }),
  end_time: z.date().nullable().optional(),
  location: z.string().min(1, { message: "Location is required" }),
  admission_source: z.string().optional()
    .transform(val => val === '' ? null : val),
})
  .refine(data => {
    // If encounter_type is inpatient, admission_source is required
    if (data.encounter_type === 'inpatient') {
      return !!data.admission_source && data.admission_source !== 'none';
    }
    return true;
  }, {
    message: "Admission source is required for inpatient encounters",
    path: ["admission_source"]
  })
  .refine(data => {
    if (data.encounter_type !== 'outpatient') {
      return true;
    }
    if (!['in-progress', 'finished'].includes(data.status)) {
      return true;
    }
    return data.start_time <= new Date();
  }, {
    message: "Future outpatient encounters cannot be in progress or finished",
    path: ["status"]
  });

const rustV2EncounterFormSchema = z.object({
  patient_id: z.string().min(1, { message: "Patient is required" }),
  encounter_type: z.enum(['outpatient', 'emergency', 'triage'], {
    message: "Encounter type is required",
  }),
});

export function EncounterForm({ isEditing = false }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const rustV2Mode = isRustV2ApiMode();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [slotSelected, setSlotSelected] = useState(false);

  // Use React Query hooks
  const {
    data: encounterData,
    isLoading: isEncounterLoading,
    isError: isEncounterError,
    error: encounterError
  } = useEncounter(isEditing ? id : null);

  // Create and update mutations
  const createEncounterMutation = useCreateEncounter();
  const updateEncounterMutation = useUpdateEncounter();

  const {
    data: patients = [],
    isLoading: isLoadingPatients,
    setSearchTerm: setPatientSearchTerm
  } = useSearchPatientsForEncounter();

  const {
    data: practitioners = [],
    isLoading: isLoadingPractitioners,
    setSearchTerm: setPractitionerSearchTerm
  } = useSearchPractitioners();

  // Initialize form with React Hook Form
  const form = useForm({
    resolver: zodResolver(rustV2Mode ? rustV2EncounterFormSchema : legacyEncounterFormSchema),
    defaultValues: {
      patient_id: '',
      practitioner_id: '',
      encounter_type: 'outpatient',
      status: 'planned',
      reason: '',
      service_type: '',
      start_time: new Date(),
      end_time: null,
      location: '',
      admission_source: '',
    }
  });

  // Load encounter data if editing
  useEffect(() => {
    if (isEditing && encounterData) {
      // Format dates
      const startTime = encounterData.start_time ? new Date(encounterData.start_time) : new Date();
      const endTime = encounterData.end_time ? new Date(encounterData.end_time) : null;

      // Set form values
      form.reset({
        patient_id: encounterData.patient_id || '',
        practitioner_id: encounterData.practitioner_id || '',
        encounter_type: encounterData.encounter_type || 'outpatient',
        status: encounterData.status || 'planned',
        reason: encounterData.reason || '',
        service_type: encounterData.service_type || '',
        start_time: startTime,
        end_time: endTime,
        location: encounterData.location || '',
        admission_source: encounterData.admission_source || '',
      });

      if (encounterData.patient_name) {
        setPatientSearchTerm(encounterData.patient_name);
      }

      if (encounterData.practitioner_name) {
        setPractitionerSearchTerm(encounterData.practitioner_name);
      }
    }
  }, [isEditing, encounterData, form, setPatientSearchTerm, setPractitionerSearchTerm]);

  // Set error state if encounter query fails
  useEffect(() => {
    if (isEncounterError) {
      setError(encounterError?.message || 'Failed to load encounter data');
      console.error('Error loading encounter:', encounterError);
    }
  }, [isEncounterError, encounterError]);

  // Handle form submission
  const onSubmit = (data) => {
    // Format dates for API
    const formattedData = rustV2Mode
      ? {
          patient_id: data.patient_id,
          encounter_type: data.encounter_type,
        }
      : {
          ...data,
          start_time: data.start_time.toISOString(),
          end_time: data.end_time ? data.end_time.toISOString() : null,
        };

    setSubmitting(true);

    if (isEditing) {
      updateEncounterMutation.mutate(
        { id, data: formattedData },
        {
          onSuccess: (response) => {
            // Navigate to the encounter detail page
            navigate(`/encounters/${id}`);
          },
          onError: (err) => {
            console.error('Error updating encounter:', err);
            setError('Failed to update encounter. Please try again.');
            setSubmitting(false);
          }
        }
      );
    } else {
      createEncounterMutation.mutate(
        formattedData,
        {
          onSuccess: (response) => {
            // Navigate to the encounter detail page
            navigate(`/encounters/${response.id}`);
          },
          onError: (err) => {
            console.error('Error creating encounter:', err);
            setError('Failed to create encounter. Please try again.');
            setSubmitting(false);
          }
        }
      );
    }
  };

  // Format patient options for SearchBar
  const patientOptions = Array.isArray(patients) ? patients.map(patient => {
    let name = "Unknown Patient";
    let id = patient?.id || "";

    // Check for simple name field first (from search API)
    if (patient?.name) {
      name = patient.name;
      id = patient.id;
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
    // Fallback to old format
    else if (patient?.user?.full_name) {
      name = patient.user.full_name;
      id = patient.id;
    }

    return {
      label: name,
      value: id
    };
  }) : [];

  // Format practitioner options for SearchBar
  const practitionerOptions = Array.isArray(practitioners) ? practitioners.map(practitioner => {
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
        value: practitioner.local_data?.id || practitioner.fhir_resource.id
      };
    } else if (practitioner.staff_details) {
      // Structure with staff_details
      return {
        label: `${practitioner.staff_details?.user_details?.first_name} ${practitioner.staff_details?.user_details?.last_name} - ${practitioner.staff_details?.specialization || 'Practitioner'}`.replace(/\s+/g, ' ').trim(),
        value: practitioner.id
      };
    } else {
      // Fallback to old format
      return {
        label: `${practitioner.user?.full_name || 'Unknown'} - ${practitioner.specialization || 'Practitioner'}`,
        value: practitioner.id
      };
    }
  }) : [];

  // Show loading state when fetching encounter data
  if (isEditing && isEncounterLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-red-500">Error</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{error}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? 'Edit Encounter' : 'New Encounter'}</CardTitle>
          <CardDescription>
            {isEditing
              ? 'Update the details of this encounter'
              : 'Enter the details for a new patient encounter'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {/* Patient selection */}
              <FormField
                control={form.control}
                name="patient_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Patient</FormLabel>
                    <FormControl>
                      <SearchBar
                        options={patientOptions}
                        value={field.value}
                        onChange={field.onChange}
                        onInputChange={setPatientSearchTerm}
                        placeholder="Search for a patient..."
                        emptyMessage={isLoadingPatients ? "Searching..." : "No patients found."}
                        searchPlaceholder="Search by name, MRN, or NHIS ID..."
                        disabled={submitting || isEditing}
                        maxHeight="20rem"
                        isLoading={isLoadingPatients}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Search for a patient by name, medical record number (MRN), or NHIS ID.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Encounter type */}
              <FormField
                control={form.control}
                name="encounter_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Encounter Type</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={submitting || (!rustV2Mode && isEditing && form.getValues("status") !== 'planned')}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select encounter type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="outpatient">Outpatient</SelectItem>
                        {!rustV2Mode && (
                          <SelectItem value="inpatient">Inpatient</SelectItem>
                        )}
                        <SelectItem value="emergency">Emergency</SelectItem>
                        {rustV2Mode && <SelectItem value="triage">Triage</SelectItem>}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      The type of encounter determines the workflow and required information.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Status */}
              {!rustV2Mode && (
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={submitting}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="planned">Planned</SelectItem>
                          <SelectItem value="in-progress">In Progress</SelectItem>
                          <SelectItem value="finished">Finished</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Practitioner */}
              {!rustV2Mode && (
                <FormField
                  control={form.control}
                  name="practitioner_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Practitioner</FormLabel>
                      <FormControl>
                        <SearchBar
                          options={practitionerOptions}
                          value={field.value}
                          onChange={field.onChange}
                          onInputChange={setPractitionerSearchTerm}
                          placeholder="Search for a practitioner..."
                          emptyMessage={isLoadingPractitioners ? "Searching..." : "No practitioners found."}
                          searchPlaceholder="Search by name, employee ID, or license number..."
                          disabled={submitting}
                          maxHeight="20rem"
                          isLoading={isLoadingPractitioners}
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Search for a doctor, nurse, or other healthcare provider.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Reason */}
              {!rustV2Mode && (
                <FormField
                  control={form.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason for Visit</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Enter the reason for this encounter..."
                          rows={2}
                          disabled={submitting}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Service Type */}
              {!rustV2Mode && (
                <FormField
                  control={form.control}
                  name="service_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Service Type</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={submitting}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select service type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="General Practice">General Practice</SelectItem>
                          <SelectItem value="Cardiology">Cardiology</SelectItem>
                          <SelectItem value="Neurology">Neurology</SelectItem>
                          <SelectItem value="Orthopedics">Orthopedics</SelectItem>
                          <SelectItem value="Pediatrics">Pediatrics</SelectItem>
                          <SelectItem value="Obstetrics">Obstetrics</SelectItem>
                          <SelectItem value="Gynecology">Gynecology</SelectItem>
                          <SelectItem value="Emergency Medicine">Emergency Medicine</SelectItem>
                          <SelectItem value="Surgery">Surgery</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Availability Calendar */}
              {!rustV2Mode && form.watch("practitioner_id") && (
                <div className="rounded-md border p-4">
                  <h3 className="text-sm font-medium mb-4">Practitioner Availability</h3>
                  <DoctorAvailabilityCalendar
                    practitionerId={form.watch("practitioner_id")}
                    onSlotSelect={(slot) => {
                      form.setValue("start_time", new Date(slot.start));
                      form.setValue("end_time", new Date(slot.end));
                      setSlotSelected(true);
                    }}
                  />
                </div>
              )}

              {/* Selected Time Display */}
              {!rustV2Mode && slotSelected && form.watch("start_time") && (
                <div className="rounded-md border p-4 bg-muted/50">
                  <div className="flex flex-col gap-y-1">
                    <span className="text-sm font-medium text-muted-foreground">Selected Time</span>
                    <span className="text-lg font-semibold">
                      {format(form.watch("start_time"), "MMMM d, yyyy hh:mm a")}
                      {form.watch("end_time") && ` - ${format(form.watch("end_time"), "hh:mm a")}`}
                    </span>
                  </div>
                </div>
              )}

              {/* Manual Time Entry - Only show if NO slot selected AND (editing OR not planned) */}
              {!rustV2Mode && !slotSelected && (isEditing || form.watch("status") !== 'planned') && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Start Time */}
                  <FormField
                    control={form.control}
                    name="start_time"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Start Time</FormLabel>
                        <FormControl>
                          <DateTimePicker
                            date={field.value}
                            setDate={field.onChange}
                            disabled={submitting}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* End Time (optional) */}
                  <FormField
                    control={form.control}
                    name="end_time"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>End Time (Optional)</FormLabel>
                        <FormControl>
                          <DateTimePicker
                            date={field.value}
                            setDate={field.onChange}
                            disabled={submitting || form.getValues("status") === 'planned'}
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          Only set an end time for completed or cancelled encounters.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {/* Location */}
              {!rustV2Mode && (
                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={submitting}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select location" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="Main Hospital">Main Hospital</SelectItem>
                          <SelectItem value="Outpatient Clinic">Outpatient Clinic</SelectItem>
                          <SelectItem value="Emergency Department">Emergency Department</SelectItem>
                          <SelectItem value="Surgical Center">Surgical Center</SelectItem>
                          <SelectItem value="Radiology">Radiology</SelectItem>
                          <SelectItem value="Laboratory">Laboratory</SelectItem>
                          <SelectItem value="Physical Therapy">Physical Therapy</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Admission Source (only for inpatient) */}
              {form.watch("encounter_type") === 'inpatient' && (
                <FormField
                  control={form.control}
                  name="admission_source"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Admission Source</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={submitting}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select admission source" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="hosp-trans">Transferred from another hospital</SelectItem>
                          <SelectItem value="emd">From emergency department</SelectItem>
                          <SelectItem value="outp">From outpatient department</SelectItem>
                          <SelectItem value="born">Born in hospital</SelectItem>
                          <SelectItem value="gp">General Practitioner referral</SelectItem>
                          <SelectItem value="mp">Medical Practitioner/physician referral</SelectItem>
                          <SelectItem value="nursing">From nursing home</SelectItem>
                          <SelectItem value="psych">From psychiatric hospital</SelectItem>
                          <SelectItem value="rehab">From rehabilitation facility</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Form actions */}
              <div className="flex justify-end gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(-1)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submitting}
                >
                  {submitting ? 'Saving...' : isEditing ? 'Update Encounter' : 'Create Encounter'}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
