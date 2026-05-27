/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { normalizeApiResults } from '@/lib/utils';
import { toast } from 'sonner';
import { useDebounce } from '@/hooks/use-debounce';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
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
import DoctorAvailabilityCalendar from '@/features/appointments/components/DoctorAvailabilityCalendar';

import { appointmentsApi } from '@/features/appointments/api';
import { patientsApi } from '@/features/patients/api';
import { referralsApi } from '@/features/referrals/api';
import { staffApi } from '@/features/staff/api';
import { clinicsApi } from '@/features/clinics/api';

const formSchema = z.object({
  patientId: z.string({
    required_error: 'Please select a patient',
  }),
  clinicId: z.string({
    required_error: 'Please select a clinic',
  }),
  practitionerId: z.string().optional(),
  appointmentTypeId: z.string({
    required_error: 'Please select an appointment type',
  }),
  slotId: z.string().optional(),
  description: z.string().optional(),
  comment: z.string().optional(),
  overbookReason: z.string().optional(),
});

function slotRequiresOverbookReason(slot) {
  const capacity = slot?.capacity || null;
  const remaining = Number(capacity?.remaining ?? 0);
  const overbookRemaining = Number(capacity?.overbook_remaining ?? 0);
  return slot?.status === 'overbook_available' || (remaining <= 0 && overbookRemaining > 0);
}

const AppointmentCreatePage = () => {
  const navigate = useNavigate();
  const { search, state: routeState } = useLocation();
  const queryInitialData = useMemo(() => {
    const params = new URLSearchParams(search || '');
    return {
      // Support deep-linking from pages that use query params instead of navigation state.
      patientId: params.get('patient') || params.get('patientId') || '',
      clinicId: params.get('clinic') || params.get('clinicId') || '',
      practitionerId: params.get('practitioner') || params.get('practitionerId') || '',
      appointmentTypeId: params.get('appointment_type') || params.get('appointmentTypeId') || '',
      slotId: params.get('slot') || params.get('slotId') || '',
      waitlistId: params.get('waitlist') || params.get('waitlistId') || '',
      description: params.get('description') || '',
      comment: params.get('comment') || '',
      overbookReason: params.get('overbook_reason') || params.get('overbookReason') || '',
    };
  }, [search]);

  const initialData = useMemo(
    () => ({ ...queryInitialData, ...(routeState || {}) }),
    [queryInitialData, routeState]
  );

  const [appointmentTypes, setAppointmentTypes] = useState([]);
  const [clinics, setClinics] = useState([]);

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

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      patientId: '',
      clinicId: '',
      practitionerId: '',
      appointmentTypeId: '',
      slotId: '',
      description: '',
      comment: '',
      overbookReason: '',
    },
  });

  const watchClinicId = form.watch('clinicId');
  const watchPractitionerId = form.watch('practitionerId');
  const watchAppointmentTypeId = form.watch('appointmentTypeId');
  const watchPatientId = form.watch('patientId');
  const watchSlotId = form.watch('slotId');
  const watchOverbookReason = form.watch('overbookReason');

  const selectedClinic = useMemo(
    () => clinics.find((clinic) => clinic.id === watchClinicId),
    [clinics, watchClinicId]
  );
  const isPoolClinic = selectedClinic?.booking_mode === 'clinic_pool';
  const requiresPractitioner = Boolean(selectedClinic) && !isPoolClinic;

  const progress = useMemo(() => {
    const total = requiresPractitioner ? 5 : 4;
    let completed = 0;
    if (watchPatientId) completed += 1;
    if (watchClinicId) completed += 1;
    if (requiresPractitioner) {
      if (watchPractitionerId) completed += 1;
    }
    if (watchAppointmentTypeId) completed += 1;
    if (watchSlotId) completed += 1;

    return { completed, total };
  }, [
    requiresPractitioner,
    watchPatientId,
    watchClinicId,
    watchPractitionerId,
    watchAppointmentTypeId,
    watchSlotId,
  ]);

  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      form.reset({
        patientId: initialData.patientId || '',
        clinicId: initialData.clinicId || '',
        practitionerId: initialData.practitionerId || '',
        appointmentTypeId: initialData.appointmentTypeId || '',
        slotId: initialData.slotId || '',
        description: initialData.description || '',
        comment: initialData.comment || '',
        overbookReason: initialData.overbookReason || '',
      });
    }
  }, [initialData, form]);

  useEffect(() => {
    const loadLookupData = async () => {
      setLoading(true);
      try {
        const [typesData, clinicsData] = await Promise.all([
          appointmentsApi.getAppointmentTypes(),
          clinicsApi.list({ is_active: true }),
        ]);

        setAppointmentTypes(Array.isArray(typesData) ? typesData : []);
        setClinics(Array.isArray(clinicsData) ? clinicsData : []);
      } catch (error) {
        console.error('Error loading lookup data:', error);
        toast.error('Failed to load appointment setup data');
      } finally {
        setLoading(false);
      }
    };

    loadLookupData();
  }, []);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        if (initialData.patientId) {
          const patientData = await patientsApi.getPatient(initialData.patientId);
          setPatients([patientData]);
        }

        if (initialData.practitionerId) {
          const result = await staffApi.searchPractitioners(initialData.practitionerId, true);
          if (Array.isArray(result) && result.length > 0) {
            setPractitioners(result);
          }
        }
      } catch (error) {
        console.error('Error loading initial create form context:', error);
      }
    };

    loadInitialData();
  }, [initialData.patientId, initialData.practitionerId]);

  useEffect(() => {
    const searchForPatients = async () => {
      if (!debouncedPatientQuery || debouncedPatientQuery.length < 2) {
        setPatients([]);
        return;
      }

      setIsLoadingPatients(true);
      try {
        const response = await patientsApi.searchPatients(debouncedPatientQuery);
        setPatients(normalizeApiResults(response));
      } catch (error) {
        console.error('Error searching patients:', error);
        setPatients([]);
      } finally {
        setIsLoadingPatients(false);
      }
    };

    searchForPatients();
  }, [debouncedPatientQuery]);

  useEffect(() => {
    const searchForPractitioners = async () => {
      if (!requiresPractitioner || !debouncedPractitionerQuery || debouncedPractitionerQuery.length < 2) {
        return;
      }

      setIsLoadingPractitioners(true);
      try {
        const results = await staffApi.searchPractitioners(debouncedPractitionerQuery, true);
        setPractitioners(Array.isArray(results) ? results : []);
      } catch (error) {
        console.error('Error searching practitioners:', error);
      } finally {
        setIsLoadingPractitioners(false);
      }
    };

    searchForPractitioners();
  }, [debouncedPractitionerQuery, requiresPractitioner]);

  const clearSelectedTime = () => {
    setSelectedSlot(null);
    form.setValue('slotId', '', { shouldDirty: true });
    form.setValue('overbookReason', '', { shouldDirty: true });
  };

  const handleClinicChange = (value, onChange) => {
    onChange(value);
    clearSelectedTime();

    const nextClinic = clinics.find((clinic) => clinic.id === value);
    if (nextClinic?.booking_mode === 'clinic_pool') {
      form.setValue('practitionerId', '', { shouldDirty: true });
      setPractitioners([]);
    }
  };

  const handlePractitionerChange = (value, onChange) => {
    onChange(value);
    clearSelectedTime();
  };

  const handleSlotSelect = (slot) => {
    setSelectedSlot(slot);
    form.setValue('slotId', slot.id, { shouldValidate: true, shouldDirty: true });
    if (!slotRequiresOverbookReason(slot)) {
      form.setValue('overbookReason', '', { shouldDirty: true });
    }
  };

  const selectedSlotRequiresOverbook = slotRequiresOverbookReason(selectedSlot);
  const waitlistEntryId = initialData.waitlistId || initialData.waitlist_id || '';
  const isWaitlistPromotion = Boolean(waitlistEntryId);

  const onSubmit = async (data) => {
    if (!selectedSlot) {
      toast.error('Please select a time slot');
      return;
    }

    if (requiresPractitioner && !data.practitionerId) {
      toast.error('Please select a doctor for this clinic');
      return;
    }

    const overbookReason = data.overbookReason?.trim();
    if (selectedSlotRequiresOverbook && !overbookReason) {
      toast.error('Overbooking approval reason is required');
      return;
    }

    setSubmitting(true);
    try {
      const appointmentData = {
        patient: data.patientId,
        clinic: data.clinicId,
        appointment_type: data.appointmentTypeId,
        clinic_session: selectedSlot.session_id,
        starts_at: selectedSlot.start,
        ends_at: selectedSlot.end,
        reason: data.description,
        notes: data.comment,
      };

      if (requiresPractitioner) {
        appointmentData.practitioner = data.practitionerId;
      }

      if (selectedSlotRequiresOverbook) {
        appointmentData.overbook_reason = overbookReason;
      }

      if (selectedClinic?.waitlist_enabled && !isWaitlistPromotion) {
        appointmentData.auto_waitlist = true;
      }

      if (isWaitlistPromotion) {
        const promotedEntry = await referralsApi.promoteClinicWaitlistEntry(
          waitlistEntryId,
          appointmentData,
        );
        toast.success('Waitlist entry promoted to appointment');
        if (promotedEntry?.scheduled_appointment_id) {
          navigate(`/appointments/${promotedEntry.scheduled_appointment_id}`);
        } else {
          navigate('/appointments');
        }
        return;
      }

      const result = await appointmentsApi.createAppointment(appointmentData);

      if (result?.waitlisted) {
        toast.success('Clinic is full. Patient added to waitlist.', {
          description: result.waitlist_entry_id
            ? `Waitlist entry: ${result.waitlist_entry_id}`
            : undefined,
        });
        navigate('/appointments');
        return;
      }

      toast.success('Appointment scheduled successfully');
      if (result?.id) {
        navigate(`/appointments/${result.id}`);
      } else {
        navigate('/appointments');
      }
    } catch (error) {
      console.error('Error creating appointment:', error);
      const errorMessage = error.message || 'Failed to create appointment';
      if (errorMessage.includes('\n')) {
        errorMessage.split('\n').forEach((message) => toast.error(message));
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const getSelectedPatientName = () => {
    if (!watchPatientId || patients.length === 0) return null;
    const patient = patients.find((item) => {
      if (item?.local_data?.id === watchPatientId) return true;
      if (item?.fhir_resource?.id === watchPatientId) return true;
      if (item?.id === watchPatientId) return true;
      return false;
    });

    if (!patient) return null;

    if (patient?.name) {
      return patient.name;
    }

    if (patient?.fhir_resource?.name?.[0]) {
      const given = patient.fhir_resource.name[0].given?.join(' ') || '';
      const family = patient.fhir_resource.name[0].family || '';
      return `${given} ${family}`.trim();
    }

    if (patient?.local_data?.user_details) {
      return `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim();
    }

    if (patient?.user?.full_name) {
      return patient.user.full_name;
    }

    return null;
  };

  const getSelectedPractitionerName = () => {
    if (!watchPractitionerId || practitioners.length === 0) return null;

    const practitioner = practitioners.find((item) => {
      if (item?.local_data?.id === watchPractitionerId) return true;
      if (item?.fhir_resource?.id === watchPractitionerId) return true;
      if (item?.id === watchPractitionerId) return true;
      return false;
    });

    if (!practitioner) return null;

    if (practitioner?.name) {
      return `Dr. ${practitioner.name}`;
    }

    if (practitioner?.fhir_resource?.name?.[0]) {
      const given = practitioner.fhir_resource.name[0].given?.join(' ') || '';
      const family = practitioner.fhir_resource.name[0].family || '';
      return `Dr. ${given} ${family}`.trim();
    }

    if (practitioner?.staff_details?.user_details) {
      return `Dr. ${practitioner.staff_details.user_details.first_name || ''} ${practitioner.staff_details.user_details.last_name || ''}`.trim();
    }

    if (practitioner?.user?.full_name) {
      return `Dr. ${practitioner.user.full_name}`;
    }

    return null;
  };

  const getSelectedTypeName = () => {
    if (!watchAppointmentTypeId) return null;
    const type = appointmentTypes.find((item) => item.id === watchAppointmentTypeId);
    return type?.name || null;
  };

  const pageMeta = usePageMeta({
    title: 'Schedule Appointment | Hospital Management System',
    breadcrumbs: [
      { label: 'Schedule', path: '/appointments' },
      { label: 'Schedule Appointment' },
    ],
  });

  if (loading) {
    return (
      <PageState
        variant="loading"
        className="min-h-screen"
      >
        {pageMeta}
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-20 w-full" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-[600px]" />
            <Skeleton className="h-[600px]" />
          </div>
        </div>
      </PageState>
    );
  }

  const formReady =
    Boolean(watchPatientId) &&
    Boolean(watchClinicId) &&
    Boolean(watchAppointmentTypeId) &&
    Boolean(watchSlotId) &&
    (!requiresPractitioner || Boolean(watchPractitionerId)) &&
    (!selectedSlotRequiresOverbook || Boolean(watchOverbookReason?.trim()));

  return (
    <PageShell className="h-screen flex flex-col overflow-hidden">
      {pageMeta}

      <div className="shrink-0 border-b border-border bg-card/50">
        <div className="px-6 py-3">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/appointments')}
                className="-ml-2 font-mono text-xs"
              >
                <ChevronLeft className="mr-1 size-4" />
                Back
              </Button>
              <div className="h-6 w-px bg-border" />
              <div className="flex items-center gap-2">
                <Calendar className="size-5 text-primary" />
                <h1 className="font-display text-lg text-foreground">
                  {isWaitlistPromotion ? 'Promote Waitlist Entry' : 'Schedule Appointment'}
                </h1>
              </div>
            </div>

            <div className="w-56 hidden sm:block">
              <div className="flex items-center justify-between mb-1 text-xs font-mono text-muted-foreground">
                <span>Setup progress</span>
                <span>{progress.completed}/{progress.total}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="h-full">
            <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] h-full">
              <div className="border-r border-border bg-card/30 p-6 space-y-6 overflow-y-auto">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    <User className="size-4 text-primary" />
                    Patient
                  </div>
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

                              if (patient?.name) {
                                name = patient.name;
                                id = patient.id;
                              } else if (patient?.fhir_resource?.name?.[0]) {
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

                <div className="space-y-2">
                  <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    <Building2 className="size-4 text-sky-500" />
                    Clinic
                  </div>
                  <FormField
                    control={form.control}
                    name="clinicId"
                    render={({ field }) => (
                      <FormItem>
                        <Select
                          onValueChange={(value) => handleClinicChange(value, field.onChange)}
                          value={field.value}
                          disabled={submitting}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select clinic..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {clinics.length > 0 ? clinics.map((clinic) => (
                              <SelectItem key={clinic.id} value={clinic.id}>
                                <div className="flex items-center gap-2">
                                  <span>{clinic.name}</span>
                                  <span className="text-xs text-muted-foreground capitalize">
                                    ({clinic.booking_mode === 'clinic_pool' ? 'Pool' : 'Direct'})
                                  </span>
                                </div>
                              </SelectItem>
                            )) : (
                              <SelectItem value="none" disabled>
                                No clinics available
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {selectedClinic && (
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      <Badge variant="outline" className="capitalize">
                        {selectedClinic.booking_mode === 'clinic_pool' ? 'Clinic Pool' : 'Practitioner Direct'}
                      </Badge>
                      {selectedClinic.waitlist_enabled && (
                        <Badge variant="outline" className="text-amber-700 border-amber-400/60 bg-amber-100/40">
                          Auto waitlist enabled
                        </Badge>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    <Stethoscope className="size-4 text-emerald-500" />
                    Doctor
                  </div>

                  {isPoolClinic ? (
                    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      Clinic pool booking: doctor assignment happens at check-in.
                    </div>
                  ) : (
                    <FormField
                      control={form.control}
                      name="practitionerId"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <SearchBar
                              options={Array.isArray(practitioners) ? practitioners.map((practitioner) => {
                                if (practitioner?.name) {
                                  return { label: `Dr. ${practitioner.name}`, value: practitioner.id };
                                }

                                if (practitioner?.fhir_resource) {
                                  const name = practitioner.fhir_resource.name?.[0];
                                  const given = name?.given?.join(' ') || '';
                                  const family = name?.family || '';
                                  const displayName = `Dr. ${given} ${family}`.trim();
                                  return { label: displayName, value: practitioner.local_data?.id || practitioner.fhir_resource.id };
                                }

                                if (practitioner?.staff_details) {
                                  return {
                                    label: `Dr. ${practitioner.staff_details?.user_details?.first_name} ${practitioner.staff_details?.user_details?.last_name}`.replace(/\s+/g, ' ').trim(),
                                    value: practitioner.id,
                                  };
                                }

                                return {
                                  label: practitioner?.user?.full_name || 'Unknown Practitioner',
                                  value: practitioner.id,
                                };
                              }) : []}
                              value={field.value}
                              onChange={(value) => handlePractitionerChange(value, field.onChange)}
                              onInputChange={setPractitionerSearchQuery}
                              placeholder={watchClinicId ? 'Search doctors...' : 'Select clinic first...'}
                              emptyMessage={isLoadingPractitioners ? 'Searching...' : 'No doctors found.'}
                              disabled={submitting || !watchClinicId}
                              maxHeight="15rem"
                              isLoading={isLoadingPractitioners}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    <FileText className="size-4 text-amber-500" />
                    Appointment Type
                  </div>
                  <FormField
                    control={form.control}
                    name="appointmentTypeId"
                    render={({ field }) => (
                      <FormItem>
                        <Select
                          onValueChange={(value) => {
                            field.onChange(value);
                            setSelectedSlot(null);
                            form.setValue('slotId', '', { shouldDirty: true });
                            form.setValue('overbookReason', '', { shouldDirty: true });
                          }}
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
                                  <span className="text-xs text-muted-foreground">({type.duration_minutes}min)</span>
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

                <div className="border-t border-border/50" />

                <div className="space-y-4">
                  {selectedSlotRequiresOverbook && (
                    <FormField
                      control={form.control}
                      name="overbookReason"
                      render={({ field }) => (
                        <FormItem>
                          <label
                            htmlFor="overbook-reason"
                            className="font-mono text-xs uppercase tracking-wider text-amber-700"
                          >
                            Overbooking Approval Reason
                          </label>
                          <FormControl>
                            <Textarea
                              id="overbook-reason"
                              placeholder="Clinician or supervisor approval"
                              className="h-16 resize-none border-amber-400/60 bg-amber-50/40 text-sm"
                              {...field}
                              disabled={submitting}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <label
                          htmlFor="appointment-description"
                          className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
                        >
                          Reason for Visit
                        </label>
                        <FormControl>
                          <Textarea
                            id="appointment-description"
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
                        <label
                          htmlFor="appointment-comment"
                          className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
                        >
                          Additional Notes
                        </label>
                        <FormControl>
                          <Textarea
                            id="appointment-comment"
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

                <div className="pt-4 border-t border-border/50 space-y-3">
                  <Button
                    type="submit"
                    className="w-full font-mono text-xs bg-primary hover:bg-primary/90"
                    disabled={submitting || !formReady}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Scheduling
                      </>
                    ) : (
                      <>
                        <CheckCircle className="mr-2 size-4" />
                        {isWaitlistPromotion ? 'Promote to Appointment' : 'Schedule Appointment'}
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full font-mono text-xs"
                    onClick={() => navigate('/appointments')}
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                </div>
              </div>

              <div className="p-6 overflow-y-auto bg-background">
                <div className="flex items-center gap-2 mb-6">
                  <Clock className="size-5 text-rose-500" />
                  <h2 className="font-display text-lg text-foreground">Select Date & Time</h2>
                </div>

                <div className="grid gap-4 mb-6 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Patient</p>
                    <p className="text-sm text-foreground truncate mt-1">{getSelectedPatientName() || 'Not selected'}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Clinic</p>
                    <p className="text-sm text-foreground truncate mt-1">{selectedClinic?.name || 'Not selected'}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Doctor</p>
                    <p className="text-sm text-foreground truncate mt-1">{isPoolClinic ? 'Assigned at check-in' : (getSelectedPractitionerName() || 'Not selected')}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Type</p>
                    <p className="text-sm text-foreground truncate mt-1">{getSelectedTypeName() || 'Not selected'}</p>
                  </div>
                </div>

                {!watchClinicId ? (
                  <div className="flex flex-col items-center justify-center py-24 text-center">
                    <div className="p-6 rounded-full bg-muted/50 mb-6">
                      <Building2 className="size-12 text-muted-foreground/50" />
                    </div>
                    <h3 className="text-xl font-medium text-foreground mb-2">Select a Clinic First</h3>
                    <p className="text-muted-foreground max-w-md">
                      Choose a clinic from the sidebar to load availability.
                    </p>
                  </div>
                ) : requiresPractitioner && !watchPractitionerId ? (
                  <div className="flex flex-col items-center justify-center py-24 text-center">
                    <div className="p-6 rounded-full bg-muted/50 mb-6">
                      <Stethoscope className="size-12 text-muted-foreground/50" />
                    </div>
                    <h3 className="text-xl font-medium text-foreground mb-2">Select a Doctor</h3>
                    <p className="text-muted-foreground max-w-md">
                      This clinic books directly to a doctor, so select a doctor to view available slots.
                    </p>
                  </div>
                ) : (
                  <FormField
                    control={form.control}
                    name="slotId"
                    render={() => (
                      <FormItem>
                        <FormControl>
                          <DoctorAvailabilityCalendar
                            clinicId={watchClinicId}
                            practitionerId={requiresPractitioner ? watchPractitionerId : undefined}
                            serviceId={watchAppointmentTypeId}
                            onSlotSelect={handleSlotSelect}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </div>
          </form>
        </Form>
      </div>
    </PageShell>
  );
};

export default AppointmentCreatePage;
