import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';

import { useDebounce } from '@/hooks/use-debounce';
import { normalizeApiResults } from '@/lib/utils';
import { appointmentsApi } from '@/features/appointments/api';
import { useAppointmentTypes } from '@/features/appointments/hooks';
import { useClinics } from '@/hooks/useOrganization';
import { patientsApi } from '@/features/patients/api';
import { referralsApi } from '@/features/referrals/api';
import { staffApi } from '@/features/staff/api';
import {
  appointmentCreateFormSchema,
  buildAppointmentPayload,
  getAppointmentCreateDefaultValues,
  getAppointmentCreateInitialData,
  getAppointmentCreateProgress,
  getPatientOption,
  getPractitionerOption,
  getSelectedAppointmentTypeName,
  getSelectedPatientName,
  getSelectedPractitionerName,
  slotRequiresOverbookReason,
} from './appointmentCreateUtils';

const EMPTY_APPOINTMENT_TYPES = [];
const EMPTY_CLINICS = [];

export function useAppointmentCreateController() {
  const navigate = useNavigate();
  const { search, state: routeState } = useLocation();
  const initialData = useMemo(
    () => getAppointmentCreateInitialData(search, routeState),
    [search, routeState]
  );
  const defaultValues = useMemo(
    () => getAppointmentCreateDefaultValues(initialData),
    [initialData]
  );

  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [patients, setPatients] = useState([]);
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const [practitionerSearchQuery, setPractitionerSearchQuery] = useState('');
  const [practitioners, setPractitioners] = useState([]);
  const [isLoadingPractitioners, setIsLoadingPractitioners] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const debouncedPatientQuery = useDebounce(patientSearchQuery, 300);
  const debouncedPractitionerQuery = useDebounce(practitionerSearchQuery, 300);
  const {
    data: appointmentTypes = EMPTY_APPOINTMENT_TYPES,
    isError: appointmentTypesError,
    isLoading: appointmentTypesLoading,
  } = useAppointmentTypes();
  const {
    data: clinics = EMPTY_CLINICS,
    isError: clinicsError,
    isLoading: clinicsLoading,
  } = useClinics({ is_active: true });
  const loading = appointmentTypesLoading || clinicsLoading;
  const lookupFailed = appointmentTypesError || clinicsError;

  const form = useForm({
    resolver: zodResolver(appointmentCreateFormSchema),
    defaultValues,
    values: defaultValues,
  });

  const [
    watchClinicId,
    watchPractitionerId,
    watchAppointmentTypeId,
    watchPatientId,
    watchSlotId,
    watchOverbookReason,
  ] = useWatch({
    control: form.control,
    name: [
      'clinicId',
      'practitionerId',
      'appointmentTypeId',
      'patientId',
      'slotId',
      'overbookReason',
    ],
  });

  const selectedClinic = useMemo(
    () => clinics.find((clinic) => clinic.id === watchClinicId),
    [clinics, watchClinicId]
  );
  const isPoolClinic = selectedClinic?.booking_mode === 'clinic_pool';
  const requiresPractitioner = Boolean(selectedClinic) && !isPoolClinic;
  const selectedSlotRequiresOverbook = slotRequiresOverbookReason(selectedSlot);
  const waitlistEntryId = initialData.waitlistId || initialData.waitlist_id || '';
  const isWaitlistPromotion = Boolean(waitlistEntryId);

  const patientOptions = useMemo(
    () => (Array.isArray(patients) ? patients.map(getPatientOption) : []),
    [patients]
  );
  const practitionerOptions = useMemo(
    () => (Array.isArray(practitioners) ? practitioners.map(getPractitionerOption) : []),
    [practitioners]
  );
  const progress = useMemo(
    () => getAppointmentCreateProgress({
      appointmentTypeId: watchAppointmentTypeId,
      clinicId: watchClinicId,
      patientId: watchPatientId,
      practitionerId: watchPractitionerId,
      requiresPractitioner,
      slotId: watchSlotId,
    }),
    [
      requiresPractitioner,
      watchAppointmentTypeId,
      watchClinicId,
      watchPatientId,
      watchPractitionerId,
      watchSlotId,
    ]
  );
  const selectedPatientName = useMemo(
    () => getSelectedPatientName(watchPatientId, patients),
    [patients, watchPatientId]
  );
  const selectedPractitionerName = useMemo(
    () => getSelectedPractitionerName(watchPractitionerId, practitioners),
    [practitioners, watchPractitionerId]
  );
  const selectedTypeName = useMemo(
    () => getSelectedAppointmentTypeName(watchAppointmentTypeId, appointmentTypes),
    [appointmentTypes, watchAppointmentTypeId]
  );

  useEffect(() => {
    if (lookupFailed) {
      toast.error('Failed to load appointment setup data');
    }
  }, [lookupFailed]);

  useEffect(() => {
    let cancelled = false;

    const loadInitialData = async () => {
      try {
        const patientPromise = initialData.patientId
          ? patientsApi.getPatient(initialData.patientId)
          : Promise.resolve(null);
        const practitionersPromise = initialData.practitionerId
          ? staffApi.searchPractitioners(initialData.practitionerId, true)
          : Promise.resolve([]);
        const [patientData, practitionersData] = await Promise.all([
          patientPromise,
          practitionersPromise,
        ]);

        if (cancelled) return;
        if (patientData) {
          setPatients([patientData]);
        }
        if (Array.isArray(practitionersData) && practitionersData.length > 0) {
          setPractitioners(practitionersData);
        }
      } catch {
        if (!cancelled) {
          toast.error('Failed to load appointment context');
        }
      }
    };

    loadInitialData();

    return () => {
      cancelled = true;
    };
  }, [initialData.patientId, initialData.practitionerId]);

  useEffect(() => {
    let cancelled = false;

    const searchForPatients = async () => {
      if (!debouncedPatientQuery || debouncedPatientQuery.length < 2) {
        setPatients([]);
        return;
      }

      setIsLoadingPatients(true);
      try {
        const response = await patientsApi.searchPatients(debouncedPatientQuery);
        if (!cancelled) {
          setPatients(normalizeApiResults(response));
        }
      } catch {
        if (!cancelled) {
          setPatients([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPatients(false);
        }
      }
    };

    searchForPatients();

    return () => {
      cancelled = true;
    };
  }, [debouncedPatientQuery]);

  useEffect(() => {
    let cancelled = false;

    const searchForPractitioners = async () => {
      if (!requiresPractitioner || !debouncedPractitionerQuery || debouncedPractitionerQuery.length < 2) {
        return;
      }

      setIsLoadingPractitioners(true);
      try {
        const results = await staffApi.searchPractitioners(debouncedPractitionerQuery, true);
        if (!cancelled) {
          setPractitioners(Array.isArray(results) ? results : []);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPractitioners(false);
        }
      }
    };

    searchForPractitioners();

    return () => {
      cancelled = true;
    };
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
      const appointmentData = buildAppointmentPayload({
        data,
        isWaitlistPromotion,
        requiresPractitioner,
        selectedClinic,
        selectedSlot,
        selectedSlotRequiresOverbook,
      });

      if (isWaitlistPromotion) {
        const promotedEntry = await referralsApi.promoteClinicWaitlistEntry(
          waitlistEntryId,
          appointmentData
        );
        toast.success('Waitlist entry promoted to appointment');
        navigate(promotedEntry?.scheduled_appointment_id
          ? `/appointments/${promotedEntry.scheduled_appointment_id}`
          : '/appointments');
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
      navigate(result?.id ? `/appointments/${result.id}` : '/appointments');
    } catch (error) {
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

  const formReady =
    Boolean(watchPatientId) &&
    Boolean(watchClinicId) &&
    Boolean(watchAppointmentTypeId) &&
    Boolean(watchSlotId) &&
    (!requiresPractitioner || Boolean(watchPractitionerId)) &&
    (!selectedSlotRequiresOverbook || Boolean(watchOverbookReason?.trim()));

  const navigateToAppointments = () => navigate('/appointments');

  return {
    appointmentTypes,
    clearSelectedTime,
    clinics,
    form,
    formReady,
    handleClinicChange,
    handlePractitionerChange,
    handleSlotSelect,
    isLoadingPatients,
    isLoadingPractitioners,
    isPoolClinic,
    isWaitlistPromotion,
    loading,
    navigateToAppointments,
    onSubmit,
    patientOptions,
    practitionerOptions,
    progress,
    requiresPractitioner,
    selectedClinic,
    selectedPatientName,
    selectedPractitionerName,
    selectedSlotRequiresOverbook,
    selectedTypeName,
    setPatientSearchQuery,
    setPractitionerSearchQuery,
    submitting,
    watchAppointmentTypeId,
    watchClinicId,
    watchPractitionerId,
  };
}
