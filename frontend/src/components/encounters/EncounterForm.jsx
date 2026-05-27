import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form } from '@/components/ui/form';
import {
  EncounterErrorState,
  EncounterFormActions,
  EncounterLoadingState,
  EncounterPatientField,
  EncounterTypeField,
  LegacyEncounterFields,
} from './EncounterFormFields';
import {
  useCreateEncounter,
  useUpdateEncounter,
  useEncounter,
  useSearchPatientsForEncounter,
  useSearchPractitioners,
} from '@/features/encounters/hooks/useEncounterQueries';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

const legacyEncounterFormSchema = z.object({
  patient_id: z.string().min(1, { message: 'Patient is required' }),
  practitioner_id: z.string().min(1, { message: 'Practitioner is required' }),
  encounter_type: z.string().min(1, { message: 'Encounter type is required' }),
  status: z.string().min(1, { message: 'Status is required' }),
  reason: z.string().min(1, { message: 'Reason for visit is required' }),
  service_type: z.string().min(1, { message: 'Service type is required' }),
  start_time: z.date({ required_error: 'Start time is required' }),
  end_time: z.date().nullable().optional(),
  location: z.string().min(1, { message: 'Location is required' }),
  admission_source: z.string().optional()
    .transform((val) => val === '' ? null : val),
})
  .refine((data) => {
    if (data.encounter_type === 'inpatient') {
      return !!data.admission_source && data.admission_source !== 'none';
    }
    return true;
  }, {
    message: 'Admission source is required for inpatient encounters',
    path: ['admission_source'],
  })
  .refine((data) => {
    if (data.encounter_type !== 'outpatient') {
      return true;
    }
    if (!['in-progress', 'finished'].includes(data.status)) {
      return true;
    }
    return data.start_time <= new Date();
  }, {
    message: 'Future outpatient encounters cannot be in progress or finished',
    path: ['status'],
  });

const rustV2EncounterFormSchema = z.object({
  patient_id: z.string().min(1, { message: 'Patient is required' }),
  encounter_type: z.enum(['outpatient', 'emergency', 'triage'], {
    message: 'Encounter type is required',
  }),
});

const DEFAULT_FORM_VALUES = {
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
};

function getEncounterFormValues(encounterData) {
  return {
    patient_id: encounterData.patient_id || '',
    practitioner_id: encounterData.practitioner_id || '',
    encounter_type: encounterData.encounter_type || 'outpatient',
    status: encounterData.status || 'planned',
    reason: encounterData.reason || '',
    service_type: encounterData.service_type || '',
    start_time: encounterData.start_time ? new Date(encounterData.start_time) : new Date(),
    end_time: encounterData.end_time ? new Date(encounterData.end_time) : null,
    location: encounterData.location || '',
    admission_source: encounterData.admission_source || '',
  };
}

function formatPatientOption(patient) {
  let name = 'Unknown Patient';
  let id = patient?.id || '';

  if (patient?.name) {
    name = patient.name;
    id = patient.id;
  } else if (patient?.fhir_resource?.name?.[0]) {
    const given = patient.fhir_resource.name[0].given?.join(' ') || '';
    const family = patient.fhir_resource.name[0].family || '';
    name = `${family}, ${given}`.trim() || 'Unknown Patient';
    id = patient.fhir_resource.id;
  } else if (patient?.local_data?.user_details) {
    name = `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim() || 'Unknown Patient';
    id = patient.local_data.id;
  } else if (patient?.user?.full_name) {
    name = patient.user.full_name;
    id = patient.id;
  }

  return { label: name, value: id };
}

function formatPractitionerOption(practitioner) {
  if (practitioner?.name) {
    return { label: practitioner.name, value: practitioner.id };
  }

  if (practitioner?.fhir_resource) {
    const name = practitioner.fhir_resource.name?.[0];
    const given = name?.given?.join(' ') || '';
    const family = name?.family || '';
    const displayName = `${family}, ${given}`.trim() || 'Unknown Practitioner';
    return {
      label: displayName,
      value: practitioner.local_data?.id || practitioner.fhir_resource.id,
    };
  }

  if (practitioner?.staff_details) {
    return {
      label: `${practitioner.staff_details?.user_details?.first_name} ${practitioner.staff_details?.user_details?.last_name} - ${practitioner.staff_details?.specialization || 'Practitioner'}`.replace(/\s+/g, ' ').trim(),
      value: practitioner.id,
    };
  }

  return {
    label: `${practitioner.user?.full_name || 'Unknown'} - ${practitioner.specialization || 'Practitioner'}`,
    value: practitioner.id,
  };
}

function prependSelectedOption(options, selectedOption) {
  if (!selectedOption?.value || options.some((option) => option.value === selectedOption.value)) {
    return options;
  }
  return [selectedOption, ...options];
}

export function EncounterForm({ isEditing = false }) {
  const { id } = useParams();
  const {
    data: encounterData,
    isLoading: isEncounterLoading,
    isError: isEncounterError,
    error: encounterError,
  } = useEncounter(isEditing ? id : null);

  if (isEditing && isEncounterLoading) {
    return <EncounterLoadingState />;
  }

  if (isEncounterError) {
    return <EncounterErrorState message={encounterError?.message || 'Failed to load encounter data'} />;
  }

  return (
    <EncounterFormEditor
      key={isEditing ? id : 'new-encounter'}
      encounterData={encounterData}
      encounterId={id}
      isEditing={isEditing}
    />
  );
}

function EncounterFormEditor({ encounterData, encounterId, isEditing }) {
  const navigate = useNavigate();
  const rustV2Mode = isRustV2ApiMode();
  const [submitting, setSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState(null);
  const [slotSelected, setSlotSelected] = useState(false);

  const createEncounterMutation = useCreateEncounter();
  const updateEncounterMutation = useUpdateEncounter();

  const {
    data: patients = [],
    isLoading: isLoadingPatients,
    setSearchTerm: setPatientSearchTerm,
  } = useSearchPatientsForEncounter();

  const {
    data: practitioners = [],
    isLoading: isLoadingPractitioners,
    setSearchTerm: setPractitionerSearchTerm,
  } = useSearchPractitioners();

  const form = useForm({
    resolver: zodResolver(rustV2Mode ? rustV2EncounterFormSchema : legacyEncounterFormSchema),
    defaultValues: isEditing && encounterData ? getEncounterFormValues(encounterData) : DEFAULT_FORM_VALUES,
  });

  const onSubmit = (data) => {
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

    setMutationError(null);
    setSubmitting(true);

    if (isEditing) {
      updateEncounterMutation.mutate(
        { id: encounterId, data: formattedData },
        {
          onSuccess: () => {
            navigate(`/encounters/${encounterId}`);
          },
          onError: (err) => {
            console.error('Error updating encounter:', err);
            setMutationError('Failed to update encounter. Please try again.');
            setSubmitting(false);
          },
        }
      );
      return;
    }

    createEncounterMutation.mutate(
      formattedData,
      {
        onSuccess: (response) => {
          navigate(`/encounters/${response.id}`);
        },
        onError: (err) => {
          console.error('Error creating encounter:', err);
          setMutationError('Failed to create encounter. Please try again.');
          setSubmitting(false);
        },
      }
    );
  };

  const patientOptions = useMemo(() => {
    const options = Array.isArray(patients) ? patients.map(formatPatientOption) : [];
    return prependSelectedOption(options, {
      label: encounterData?.patient_name,
      value: encounterData?.patient_id,
    });
  }, [encounterData?.patient_id, encounterData?.patient_name, patients]);

  const practitionerOptions = useMemo(() => {
    const options = Array.isArray(practitioners) ? practitioners.map(formatPractitionerOption) : [];
    return prependSelectedOption(options, {
      label: encounterData?.practitioner_name,
      value: encounterData?.practitioner_id,
    });
  }, [encounterData?.practitioner_id, encounterData?.practitioner_name, practitioners]);

  const status = form.watch('status');
  const encounterType = form.watch('encounter_type');
  const practitionerId = form.watch('practitioner_id');
  const startTime = form.watch('start_time');
  const endTime = form.watch('end_time');

  if (mutationError) {
    return <EncounterErrorState message={mutationError} />;
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
              <EncounterPatientField
                control={form.control}
                disabled={submitting}
                isEditing={isEditing}
                isLoadingPatients={isLoadingPatients}
                patientOptions={patientOptions}
                onPatientSearch={setPatientSearchTerm}
              />

              <EncounterTypeField
                control={form.control}
                disabled={submitting}
                isEditing={isEditing}
                rustV2Mode={rustV2Mode}
                status={status}
              />

              {!rustV2Mode && (
                <LegacyEncounterFields
                  control={form.control}
                  disabled={submitting}
                  encounterType={encounterType}
                  endTimeDisabled={status === 'planned'}
                  isLoadingPractitioners={isLoadingPractitioners}
                  practitionerId={practitionerId}
                  practitionerOptions={practitionerOptions}
                  showManualTime={!slotSelected && (isEditing || status !== 'planned')}
                  slotSelected={slotSelected}
                  startTime={startTime}
                  endTime={endTime}
                  onPractitionerSearch={setPractitionerSearchTerm}
                  onSlotSelect={(slot) => {
                    form.setValue('start_time', new Date(slot.start));
                    form.setValue('end_time', new Date(slot.end));
                    setSlotSelected(true);
                  }}
                />
              )}

              <EncounterFormActions
                disabled={submitting}
                isEditing={isEditing}
                submitting={submitting}
                onCancel={() => navigate(-1)}
              />
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
