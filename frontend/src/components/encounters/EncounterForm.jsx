import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchBar } from '@/components/ui/search-bar';
import { format } from 'date-fns';
import { useDebounce } from '@/hooks/use-debounce';
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
  createEncounter,
  updateEncounter,
  fetchEncounter,
  searchPatientsForEncounter,
  searchPractitionersForEncounter
} from '@/lib/api.js';

// Form validation schema
const encounterFormSchema = z.object({
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
});

export function EncounterForm({ isEditing = false }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const [loading, setLoading] = useState(isEditing);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [patients, setPatients] = useState([]);
  const [practitioners, setPractitioners] = useState([]);

  // Search state
  const [patientSearchQuery, setPatientSearchQuery] = useState("");
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const debouncedPatientQuery = useDebounce(patientSearchQuery, 300);

  const [practitionerSearchQuery, setPractitionerSearchQuery] = useState("");
  const [isLoadingPractitioners, setIsLoadingPractitioners] = useState(false);
  const debouncedPractitionerQuery = useDebounce(practitionerSearchQuery, 300);

  // Initialize form with React Hook Form
  const form = useForm({
    resolver: zodResolver(encounterFormSchema),
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
    if (isEditing && id) {
      const loadEncounter = async () => {
        try {
          setLoading(true);
          const data = await fetchEncounter(id);

          // Format dates
          const startTime = data.start_time ? new Date(data.start_time) : new Date();
          const endTime = data.end_time ? new Date(data.end_time) : null;

          // Set form values
          form.reset({
            patient_id: data.patient_id || '',
            practitioner_id: data.practitioner_id || '',
            encounter_type: data.encounter_type || 'outpatient',
            status: data.status || 'planned',
            reason: data.reason || '',
            service_type: data.service_type || '',
            start_time: startTime,
            end_time: endTime,
            location: data.location || '',
            admission_source: data.admission_source || '',
          });

          // Set patient and practitioner search queries to display names
          if (data.patient_name) {
            setPatientSearchQuery(data.patient_name);
          }

          if (data.practitioner_name) {
            setPractitionerSearchQuery(data.practitioner_name);
          }
        } catch (err) {
          console.error('Error loading encounter:', err);
          setError('Failed to load encounter data');
        } finally {
          setLoading(false);
        }
      };

      loadEncounter();
    }
  }, [isEditing, id, form]);

  // Search for patients when query changes
  useEffect(() => {
    const searchForPatients = async () => {
      if (!debouncedPatientQuery || debouncedPatientQuery.length < 2) {
        setPatients([]);
        return;
      }

      setIsLoadingPatients(true);
      try {
        const response = await searchPatientsForEncounter(debouncedPatientQuery);
        const patientsData = response.patients || [];
        setPatients(Array.isArray(patientsData) ? patientsData : []);
      } catch (err) {
        console.error('Error searching patients:', err);
        setError('Failed to search patients');
        setPatients([]);
      } finally {
        setIsLoadingPatients(false);
      }
    };

    searchForPatients();
  }, [debouncedPatientQuery]);

  // Search for practitioners when query changes
  useEffect(() => {
    const searchForPractitioners = async () => {
      if (!debouncedPractitionerQuery || debouncedPractitionerQuery.length < 2) {
        setPractitioners([]);
        return;
      }

      setIsLoadingPractitioners(true);
      try {
        const results = await searchPractitionersForEncounter(debouncedPractitionerQuery, false);
        setPractitioners(Array.isArray(results) ? results : []);
      } catch (err) {
        console.error('Error searching practitioners:', err);
        setError('Failed to search practitioners');
        setPractitioners([]);
      } finally {
        setIsLoadingPractitioners(false);
      }
    };

    searchForPractitioners();
  }, [debouncedPractitionerQuery]);

  // Handle form submission
  const onSubmit = async (data) => {
    try {
      setSubmitting(true);

      // Format dates for API
      const formattedData = {
        ...data,
        start_time: data.start_time.toISOString(),
        end_time: data.end_time ? data.end_time.toISOString() : null,
      };

      let response;
      if (isEditing) {
        response = await updateEncounter(id, formattedData);
      } else {
        response = await createEncounter(formattedData);
      }

      // Navigate to the encounter detail page
      navigate(`/encounters/${response.id || id}`);
    } catch (err) {
      console.error('Error saving encounter:', err);
      setError('Failed to save encounter. Please try again.');
      setSubmitting(false);
    }
  };

  // Format patient options for SearchBar
  const patientOptions = Array.isArray(patients) ? patients.map(patient => {
    let name = "Unknown Patient";
    let id = "";

    // Check for FHIR resource format
    if (patient?.fhir_resource?.name?.[0]) {
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

  if (loading) {
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
                        onInputChange={setPatientSearchQuery}
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
                      disabled={submitting || (isEditing && form.getValues("status") !== 'planned')}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select encounter type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="outpatient">Outpatient</SelectItem>
                        <SelectItem value="inpatient">Inpatient</SelectItem>
                        <SelectItem value="emergency">Emergency</SelectItem>
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

              {/* Practitioner */}
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
                        onInputChange={setPractitionerSearchQuery}
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

              {/* Reason */}
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

              {/* Service Type */}
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

              {/* Location */}
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
