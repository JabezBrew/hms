import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, addMinutes, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useDebounce } from '@/hooks/use-debounce';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
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
import { SearchBar } from '@/components/ui/search-bar';
import DoctorAvailabilityCalendar from '@/components/appointments/DoctorAvailabilityCalendar';

import {
  ChevronLeft,
  Calendar,
  User,
  Stethoscope,
  FileText,
  Clock,
  CheckCircle,
  Loader2
} from 'lucide-react';

import {
  fetchAppointmentTypes,
  createAppointment,
  fetchPatient,
  searchPatients,
  searchPractitioners
} from '@/lib/api.js';

// Form validation schema
const formSchema = z.object({
  patientId: z.string({
    required_error: 'Please select a patient',
  }),
  practitionerId: z.string({
    required_error: 'Please select a practitioner',
  }),
  appointmentTypeId: z.string({
    required_error: 'Please select an appointment type',
  }),
  slotId: z.string().optional(),
  description: z.string().optional(),
  comment: z.string().optional(),
});

/**
 * AppointmentCreatePage - Chronicle-style appointment scheduling
 *
 * Features:
 * - Modern two-column layout with form and calendar
 * - Elegant patient/practitioner search
 * - Integrated availability calendar with slot selection
 * - Visual progress indication
 */
const AppointmentCreatePage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const initialData = location.state || {};

  // Form state
  const [appointmentTypes, setAppointmentTypes] = useState([]);
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [patients, setPatients] = useState([]);
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const debouncedPatientQuery = useDebounce(patientSearchQuery, 300);

  const [practitionerSearchQuery, setPractitionerSearchQuery] = useState('');
  const [practitioners, setPractitioners] = useState([]);
  const [isLoadingPractitioners, setIsLoadingPractitioners] = useState(false);
  const debouncedPractitionerQuery = useDebounce(practitionerSearchQuery, 300);

  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Initialize form
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      patientId: '',
      practitionerId: '',
      appointmentTypeId: '',
      slotId: '',
      description: '',
      comment: '',
    },
  });

  // Watch form values
  const watchPractitionerId = form.watch('practitionerId');
  const watchAppointmentTypeId = form.watch('appointmentTypeId');
  const watchPatientId = form.watch('patientId');
  const watchSlotId = form.watch('slotId');

  // Progress tracking
  const progress = useMemo(() => {
    let completed = 0;
    if (watchPatientId) completed++;
    if (watchPractitionerId) completed++;
    if (watchAppointmentTypeId) completed++;
    if (watchSlotId) completed++;
    return { completed, total: 4 };
  }, [watchPatientId, watchPractitionerId, watchAppointmentTypeId, watchSlotId]);

  // Reset form with initialData
  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      form.reset({
        patientId: initialData.patientId || '',
        practitionerId: initialData.practitionerId || '',
        appointmentTypeId: initialData.appointmentTypeId || '',
        slotId: initialData.slotId || '',
        description: initialData.description || '',
        comment: initialData.comment || '',
      });
    }
  }, [initialData, form]);

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
  }, []);

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      try {
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
      } finally {
        setLoading(false);
      }
    };
    loadInitialData();
  }, [initialData.patientId, initialData.practitionerId]);

  // Search patients
  useEffect(() => {
    const searchForPatients = async () => {
      if (!debouncedPatientQuery || debouncedPatientQuery.length < 2) {
        setPatients([]);
        return;
      }

      setIsLoadingPatients(true);
      try {
        const response = await searchPatients(debouncedPatientQuery);
        const patientsData = response.patients || [];
        setPatients(Array.isArray(patientsData) ? patientsData : []);
      } catch (error) {
        console.error('Error searching patients:', error);
        setPatients([]);
      } finally {
        setIsLoadingPatients(false);
      }
    };
    searchForPatients();
  }, [debouncedPatientQuery]);

  // Search practitioners
  useEffect(() => {
    const searchForPractitioners = async () => {
      if (!debouncedPractitionerQuery || debouncedPractitionerQuery.length < 2) {
        return;
      }

      setIsLoadingPractitioners(true);
      try {
        const results = await searchPractitioners(debouncedPractitionerQuery, true);
        setPractitioners(Array.isArray(results) ? results : []);
      } catch (error) {
        console.error('Error searching practitioners:', error);
      } finally {
        setIsLoadingPractitioners(false);
      }
    };
    searchForPractitioners();
  }, [debouncedPractitionerQuery]);

  // Handle slot selection
  const handleSlotSelect = (slot) => {
    setSelectedSlot(slot);
    form.setValue('slotId', slot.id);
  };

  // Handle form submission
  const onSubmit = async (data) => {
    if (!data.slotId) {
      toast.error('Please select a time slot');
      return;
    }

    setSubmitting(true);
    try {
      const appointmentData = {
        patient_id: data.patientId,
        practitioner_id: data.practitionerId,
        appointment_type_id: data.appointmentTypeId,
        slot_id: data.slotId,
        description: data.description,
        comment: data.comment,
      };

      const result = await createAppointment(appointmentData);
      toast.success('Appointment scheduled successfully');
      navigate(`/appointments/${result.id}`);
    } catch (error) {
      console.error('Error creating appointment:', error);
      toast.error(error.message || 'Failed to create appointment');
    } finally {
      setSubmitting(false);
    }
  };

  // Get selected patient name
  const getSelectedPatientName = () => {
    if (!watchPatientId || patients.length === 0) return null;
    const patient = patients.find(p => {
      // Match using local_data.id (preferred) or fhir_resource.id or direct id
      if (p?.local_data?.id === watchPatientId) return true;
      if (p?.fhir_resource?.id === watchPatientId) return true;
      if (p?.id === watchPatientId) return true;
      return false;
    });
    if (!patient) return null;

    if (patient?.fhir_resource?.name?.[0]) {
      const given = patient.fhir_resource.name[0].given?.join(' ') || '';
      const family = patient.fhir_resource.name[0].family || '';
      return `${given} ${family}`.trim();
    } else if (patient?.local_data?.user_details) {
      return `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim();
    } else if (patient?.user?.full_name) {
      return patient.user.full_name;
    }
    return null;
  };

  // Get selected practitioner name
  const getSelectedPractitionerName = () => {
    if (!watchPractitionerId || practitioners.length === 0) return null;
    const practitioner = practitioners.find(p => {
      // Match using local_data.id (preferred) or fhir_resource.id or direct id
      if (p?.local_data?.id === watchPractitionerId) return true;
      if (p?.fhir_resource?.id === watchPractitionerId) return true;
      if (p?.id === watchPractitionerId) return true;
      return false;
    });
    if (!practitioner) return null;

    if (practitioner?.fhir_resource?.name?.[0]) {
      const given = practitioner.fhir_resource.name[0].given?.join(' ') || '';
      const family = practitioner.fhir_resource.name[0].family || '';
      return `Dr. ${given} ${family}`.trim();
    } else if (practitioner?.staff_details?.user_details) {
      return `Dr. ${practitioner.staff_details.user_details.first_name || ''} ${practitioner.staff_details.user_details.last_name || ''}`.trim();
    } else if (practitioner?.user?.full_name) {
      return `Dr. ${practitioner.user.full_name}`;
    }
    return null;
  };

  // Get selected appointment type name
  const getSelectedTypeName = () => {
    if (!watchAppointmentTypeId) return null;
    const type = appointmentTypes.find(t => t.id === watchAppointmentTypeId);
    return type?.name || null;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-20 w-full" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-[600px]" />
            <Skeleton className="h-[600px]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Schedule Appointment | Hospital Management System</title>
      </Helmet>

      <div className="h-screen flex flex-col bg-background overflow-hidden">
        {/* Header */}
        <div className="shrink-0 border-b border-border bg-card/50">
          <div className="px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/appointments')}
                  className="-ml-2"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
                <div className="h-6 w-px bg-border" />
                <div className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-primary" />
                  <h1 className="text-lg font-semibold text-foreground">Schedule Appointment</h1>
                </div>
              </div>

              {/* Progress Indicator */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono",
                    watchPatientId
                      ? "bg-emerald-500/20 text-emerald-600"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {watchPatientId ? <CheckCircle className="h-4 w-4" /> : '1'}
                  </div>
                  <span className="text-xs text-muted-foreground hidden sm:inline">Patient</span>
                </div>
                <div className="w-4 h-px bg-border" />
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono",
                    watchPractitionerId
                      ? "bg-emerald-500/20 text-emerald-600"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {watchPractitionerId ? <CheckCircle className="h-4 w-4" /> : '2'}
                  </div>
                  <span className="text-xs text-muted-foreground hidden sm:inline">Doctor</span>
                </div>
                <div className="w-4 h-px bg-border" />
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono",
                    watchAppointmentTypeId
                      ? "bg-emerald-500/20 text-emerald-600"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {watchAppointmentTypeId ? <CheckCircle className="h-4 w-4" /> : '3'}
                  </div>
                  <span className="text-xs text-muted-foreground hidden sm:inline">Type</span>
                </div>
                <div className="w-4 h-px bg-border" />
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono",
                    watchSlotId
                      ? "bg-emerald-500/20 text-emerald-600"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {watchSlotId ? <CheckCircle className="h-4 w-4" /> : '4'}
                  </div>
                  <span className="text-xs text-muted-foreground hidden sm:inline">Time</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content - Two Column Layout */}
        <div className="flex-1 overflow-hidden">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="h-full">
              <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] h-full">
                {/* Left Sidebar - Compact Form */}
                <div className="border-r border-border bg-card/30 p-6 space-y-6 overflow-y-auto">
                  {/* Patient Selection */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <User className="h-4 w-4 text-primary" />
                      Patient
                    </label>
                    <FormField
                      control={form.control}
                      name="patientId"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <SearchBar
                              options={Array.isArray(patients) ? patients.map((patient) => {
                                let name = 'Unknown Patient';
                                let id = '';

                                if (patient?.fhir_resource?.name?.[0]) {
                                  const given = patient.fhir_resource.name[0].given?.join(' ') || '';
                                  const family = patient.fhir_resource.name[0].family || '';
                                  name = `${family}, ${given}`.trim() || 'Unknown Patient';
                                  id = patient.local_data?.id || patient.fhir_resource.id;
                                } else if (patient?.local_data?.user_details) {
                                  name = `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim() || 'Unknown Patient';
                                  id = patient.local_data.id;
                                } else if (patient?.id) {
                                  name = patient.user?.full_name || 'Unknown Patient';
                                  id = patient.id;
                                }

                                return { label: name, value: id };
                              }) : []}
                              value={field.value}
                              onChange={field.onChange}
                              onInputChange={setPatientSearchQuery}
                              placeholder="Search patients..."
                              emptyMessage={isLoadingPatients ? 'Searching...' : 'No patients found.'}
                              disabled={submitting}
                              maxHeight="15rem"
                              isLoading={isLoadingPatients}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Practitioner Selection */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Stethoscope className="h-4 w-4 text-emerald-500" />
                      Doctor
                    </label>
                    <FormField
                      control={form.control}
                      name="practitionerId"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <SearchBar
                              options={Array.isArray(practitioners) ? practitioners.map((practitioner) => {
                                if (practitioner.fhir_resource) {
                                  const name = practitioner.fhir_resource.name?.[0];
                                  const given = name?.given?.join(' ') || '';
                                  const family = name?.family || '';
                                  const displayName = `Dr. ${given} ${family}`.trim();
                                  return { label: displayName, value: practitioner.local_data?.id || practitioner.fhir_resource.id };
                                } else if (practitioner.staff_details) {
                                  return {
                                    label: `Dr. ${practitioner.staff_details?.user_details?.first_name} ${practitioner.staff_details?.user_details?.last_name}`.replace(/\s+/g, ' ').trim(),
                                    value: practitioner.id
                                  };
                                } else {
                                  return {
                                    label: practitioner.user?.full_name || 'Unknown',
                                    value: practitioner.id
                                  };
                                }
                              }) : []}
                              value={field.value}
                              onChange={field.onChange}
                              onInputChange={setPractitionerSearchQuery}
                              placeholder="Search doctors..."
                              emptyMessage={isLoadingPractitioners ? 'Searching...' : 'No doctors found.'}
                              disabled={submitting}
                              maxHeight="15rem"
                              isLoading={isLoadingPractitioners}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Appointment Type Selection */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <FileText className="h-4 w-4 text-amber-500" />
                      Appointment Type
                    </label>
                    <FormField
                      control={form.control}
                      name="appointmentTypeId"
                      render={({ field }) => (
                        <FormItem>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                            disabled={submitting}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select type..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {Array.isArray(appointmentTypes) ? appointmentTypes.map((type) => (
                                <SelectItem key={type.id} value={type.id}>
                                  <div className="flex items-center gap-2">
                                    <span>{type.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      ({type.duration_minutes}min)
                                    </span>
                                  </div>
                                </SelectItem>
                              )) : (
                                <SelectItem value="none" disabled>
                                  No types available
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Divider */}
                  <div className="border-t border-border/50" />

                  {/* Notes */}
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Reason for Visit</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Brief description..."
                              className="resize-none h-16 text-sm"
                              {...field}
                              disabled={submitting}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="comment"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Additional Notes</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Special instructions..."
                              className="resize-none h-16 text-sm"
                              {...field}
                              disabled={submitting}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Submit Buttons */}
                  <div className="pt-4 border-t border-border/50 space-y-3">
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={submitting || !watchSlotId}
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Scheduling...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Schedule Appointment
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => navigate('/appointments')}
                      disabled={submitting}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>

                {/* Right Side - Calendar (Full Width) */}
                <div className="p-6 overflow-y-auto bg-background">
                  <div className="flex items-center gap-2 mb-6">
                    <Clock className="h-5 w-5 text-rose-500" />
                    <h2 className="text-lg font-semibold text-foreground">Select Date & Time</h2>
                  </div>

                  {watchPractitionerId ? (
                    <FormField
                      control={form.control}
                      name="slotId"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <DoctorAvailabilityCalendar
                              practitionerId={watchPractitionerId}
                              onSlotSelect={handleSlotSelect}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                      <div className="p-6 rounded-full bg-muted/50 mb-6">
                        <Calendar className="h-12 w-12 text-muted-foreground/50" />
                      </div>
                      <h3 className="text-xl font-medium text-foreground mb-2">
                        Select a Doctor First
                      </h3>
                      <p className="text-muted-foreground max-w-md">
                        Choose a doctor from the sidebar to view their available appointment slots
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </form>
          </Form>
        </div>
      </div>
    </>
  );
};

export default AppointmentCreatePage;
