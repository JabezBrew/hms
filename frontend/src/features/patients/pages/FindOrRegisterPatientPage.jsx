import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  useEmergencyIntake,
  useInpatientIntake,
  useOutpatientIntake,
} from '@/features/care-areas/hooks/useCareAreaQueries';
import { patientsApi } from '@/features/patients/api';
import {
  usePatientIdentityLookup,
  usePatientIdentityLookupSession,
  useRegisterPatient,
} from '@/features/patients/hooks/usePatientQueries';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

const INTENT_LABELS = {
  outpatient: 'Outpatient',
  inpatient: 'Inpatient',
  emergency: 'Emergency',
};

const EMPTY_FORM = {
  patient_code: '',
  first_name: '',
  last_name: '',
  date_of_birth: '',
  sex: '',
};

const LOOKUP_ID_PARAM = 'lookup_id';
const CLINICAL_ROLES = new Set([
  'admin',
  'doctor',
  'nurse',
  'head_nurse',
  'nurse_practitioner',
  'inpatient_doctor',
  'practitioner',
  'physician',
]);

function formatStatus(candidate) {
  const record = String(candidate?.record_status || 'registered').replaceAll('_', ' ');
  const vital = String(candidate?.vital_status || 'unknown').replaceAll('_', ' ');
  return `${record} / ${vital}`;
}

function candidateId(candidate) {
  return candidate?.patient_id || candidate?.id;
}

function canonicalCandidateId(candidate) {
  return candidate?.superseded_by_patient_id || candidate?.canonical_patient_id || null;
}

function getPatientId(patient) {
  return patient?.id || patient?.local_data?.id || patient?.fhir_data?.id || null;
}

function normalizeIntent(value) {
  return ['outpatient', 'inpatient', 'emergency'].includes(value) ? value : null;
}

function PatientLookupForm({
  form,
  lookupDisabled,
  lookupPending,
  onFieldChange,
  onSubmit,
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2">
          <Label htmlFor="patient-code">MRN / Hospital Number</Label>
          <Input
            id="patient-code"
            value={form.patient_code}
            onChange={(event) => onFieldChange('patient_code', event.target.value)}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Optional. Use only when the patient already has a hospital number.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <div className="space-y-2">
            <Label htmlFor="first-name">First name</Label>
            <Input
              id="first-name"
              value={form.first_name}
              onChange={(event) => onFieldChange('first_name', event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last-name">Last name</Label>
            <Input
              id="last-name"
              value={form.last_name}
              onChange={(event) => onFieldChange('last_name', event.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <div className="space-y-2">
            <Label htmlFor="date-of-birth">Date of birth</Label>
            <Input
              id="date-of-birth"
              type="date"
              value={form.date_of_birth}
              onChange={(event) => onFieldChange('date_of_birth', event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sex">Sex</Label>
            <Select value={form.sex || 'unknown'} onValueChange={(value) => onFieldChange('sex', value)}>
              <SelectTrigger id="sex">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="other">Other</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Search by MRN, or enter date of birth plus a first or last name.
        </div>
        <Button type="submit" className="w-full" disabled={lookupDisabled || lookupPending}>
          <Search className="mr-2 size-4" />
          Check for Existing Patient
        </Button>
      </form>
    </section>
  );
}

function IntakeContextWarnings({ canStartInpatient, canStartOutpatient }) {
  return (
    <>
      {!canStartInpatient ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Inpatient intake needs a ward context.
        </div>
      ) : null}
      {!canStartOutpatient ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Outpatient intake needs a clinic context.
        </div>
      ) : null}
    </>
  );
}

function MatchingRecordsPanel({
  candidates,
  interactionState,
  lookupState,
  onOpenChronicle,
  onUseCandidate,
}) {
  const { canOpenChronicle, canStartCareContext, isBusy } = interactionState;
  const { status } = lookupState;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">Matching Records</h2>
      </div>
      {status === 'restoring' ? (
        <p className="px-4 py-8 text-sm text-muted-foreground">Restoring lookup results...</p>
      ) : status === 'expired' ? (
        <p className="px-4 py-8 text-sm text-muted-foreground">
          Lookup expired. Run the check again.
        </p>
      ) : status === 'idle' ? (
        <p className="px-4 py-8 text-sm text-muted-foreground">No lookup run.</p>
      ) : candidates.length === 0 ? (
        <p className="px-4 py-8 text-sm text-muted-foreground">
          {lookupState.registrationDetailsAvailable
            ? 'No matching records. Continue new registration with the details entered.'
            : 'No matching records. Re-enter identity details to continue new registration.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Patient</th>
                <th className="px-4 py-3 font-medium">DOB</th>
                <th className="px-4 py-3 font-medium">Sex</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {candidates.map((candidate) => {
                const action = onUseCandidate.getActionState(candidate);
                return (
                  <tr key={candidateId(candidate)}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{candidate.display_name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{candidate.patient_code}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{candidate.date_of_birth}</td>
                    <td className="px-4 py-3 capitalize">{candidate.sex}</td>
                    <td className="px-4 py-3 capitalize">{formatStatus(candidate)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {canOpenChronicle && !onUseCandidate.intent ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => onOpenChronicle(action.canonicalId || candidateId(candidate))}
                          >
                            <FileText className="mr-2 size-4" />
                            Open Chronicle
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          disabled={isBusy || !canStartCareContext || action.disabled}
                          onClick={() => onUseCandidate.handle(candidate)}
                        >
                          <ArrowRight className="mr-2 size-4" />
                          {action.label}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewPatientRegistrationPanel({
  candidates,
  onRegister,
  overrideReasonCode,
  overrideReasonNote,
  registrationState,
  setOverrideReasonCode,
  setOverrideReasonNote,
}) {
  const {
    canStartCareContext,
    hasLookup,
    hasRequiredDetails,
    isBusy,
  } = registrationState;

  if (!hasLookup) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">New Patient Registration</h2>
          <p className="text-sm text-muted-foreground">
            {!hasRequiredDetails
              ? 'Lookup results restored. Re-enter identity details before registering a new record.'
              : candidates.length > 0
                ? 'Duplicate review required.'
                : 'No match found. A hospital number will be generated after registration.'}
          </p>
        </div>
        <Button
          type="button"
          disabled={isBusy || !hasRequiredDetails || !canStartCareContext}
          onClick={onRegister}
        >
          <UserPlus className="mr-2 size-4" />
          {candidates.length > 0 ? 'Register New Distinct Patient' : 'Continue New Registration'}
        </Button>
      </div>
      {candidates.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
          <div className="space-y-2">
            <Label htmlFor="duplicate-reason">Reason</Label>
            <Select value={overrideReasonCode} onValueChange={setOverrideReasonCode}>
              <SelectTrigger id="duplicate-reason">
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="different_person_confirmed">Different person confirmed</SelectItem>
                <SelectItem value="identity_document_reviewed">Identity document reviewed</SelectItem>
                <SelectItem value="guardian_confirmed_distinct">Guardian confirmed distinct</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="duplicate-note">Note</Label>
            <Textarea
              id="duplicate-note"
              value={overrideReasonNote}
              onChange={(event) => setOverrideReasonNote(event.target.value)}
              rows={3}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function useFindOrRegisterPatientWorkflow() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const intent = normalizeIntent(searchParams.get('intent'));
  const clinicId = searchParams.get('clinic_id') || null;
  const wardId = searchParams.get('ward_id') || null;
  const lookupId = searchParams.get(LOOKUP_ID_PARAM) || null;
  const [form, setForm] = useState(EMPTY_FORM);
  const [lookupResult, setLookupResult] = useState(null);
  const [overrideReasonCode, setOverrideReasonCode] = useState('');
  const [overrideReasonNote, setOverrideReasonNote] = useState('');

  const lookupMutation = usePatientIdentityLookup();
  const lookupSessionQuery = usePatientIdentityLookupSession(lookupId, {
    enabled: Boolean(lookupId) && !lookupResult,
  });
  const registerMutation = useRegisterPatient();
  const outpatientIntake = useOutpatientIntake();
  const inpatientIntake = useInpatientIntake();
  const emergencyIntake = useEmergencyIntake();

  const activeLookupResult = lookupResult || lookupSessionQuery.data || null;
  const candidates = Array.isArray(activeLookupResult?.candidates) ? activeLookupResult.candidates : [];
  const hasLookup = Boolean(activeLookupResult);
  const intentLabel = intent ? INTENT_LABELS[intent] : null;
  const lookupStatus = lookupSessionQuery.isFetching
    ? 'restoring'
    : lookupSessionQuery.isError
      ? 'expired'
      : hasLookup
        ? 'ready'
        : 'idle';

  const pageMeta = usePageMeta({
    title: intentLabel
      ? `${intentLabel} Patient Intake | Hospital Management System`
      : 'Find or Register Patient | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'Find or Register' },
    ],
  });

  const canStartInpatient = intent !== 'inpatient' || Boolean(wardId);
  const canStartOutpatient = intent !== 'outpatient' || Boolean(clinicId);
  const canStartCareContext = canStartInpatient && canStartOutpatient;
  const hasRequiredRegistrationDetails = Boolean(
    form.first_name.trim() && form.last_name.trim() && form.date_of_birth,
  );
  const isBusy = lookupMutation.isPending
    || lookupSessionQuery.isFetching
    || registerMutation.isPending
    || outpatientIntake.isPending
    || inpatientIntake.isPending
    || emergencyIntake.isPending;
  const canOpenChronicle = CLINICAL_ROLES.has(user?.role);
  const returnTo = `${location.pathname}${location.search}`;

  const lookupDisabled = useMemo(() => {
    const hasCode = form.patient_code.trim();
    const hasDobPlusName = form.date_of_birth && (form.first_name.trim() || form.last_name.trim());
    return !hasCode && !hasDobPlusName;
  }, [form]);

  const clearLookupSession = () => {
    if (!activeLookupResult && !lookupId) {
      return;
    }
    setLookupResult(null);
    setOverrideReasonCode('');
    setOverrideReasonNote('');
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete(LOOKUP_ID_PARAM);
    setSearchParams(nextParams, { replace: true });
  };

  const setField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    clearLookupSession();
  };

  const runLookup = async (event) => {
    event.preventDefault();
    const result = await lookupMutation.mutateAsync({
      ...form,
      limit: 10,
    });
    setLookupResult(result);
    setOverrideReasonCode('');
    setOverrideReasonNote('');
    if (result?.lookup_id) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(LOOKUP_ID_PARAM, result.lookup_id);
      setSearchParams(nextParams, { replace: true });
    }
  };

  const navigateToPatientProfile = (patientId) => {
    navigate(`/patients/${patientId}/profile`, { state: { returnTo } });
  };

  const navigateToPatientChronicle = (patientId) => {
    navigate(`/patients/${patientId}/chronicle`, { state: { returnTo } });
  };

  const startContext = async (patientId) => {
    if (!intent) {
      navigateToPatientProfile(patientId);
      return;
    }
    if (intent === 'outpatient' && !clinicId) {
      toast.error('Select a clinic before outpatient intake');
      return;
    }
    if (intent === 'inpatient' && !wardId) {
      toast.error('Select a ward before inpatient intake');
      return;
    }
    const contexts = await patientsApi.getCurrentContexts(patientId);
    if (intent === 'outpatient') {
      const existing = contexts?.outpatient?.find((context) => context.clinic_id === clinicId);
      if (existing) {
        toast.info('Patient is already in this clinic workflow');
        navigate(`/clinics/${clinicId}/waiting-room`);
        return;
      }
    }
    if (intent === 'inpatient' && contexts?.inpatient?.length > 0) {
      toast.info('Patient already has a current inpatient admission');
      navigate('/ward-board');
      return;
    }
    if (intent === 'emergency' && contexts?.emergency?.length > 0) {
      toast.info('Patient already has a current emergency workflow');
      navigate('/triage');
      return;
    }
    const idempotencyKey = globalThis.crypto?.randomUUID?.() || `${Date.now()}`;
    if (intent === 'outpatient') {
      await outpatientIntake.mutateAsync({
        patient_id: patientId,
        clinic_id: clinicId,
        appointment_id: null,
        idempotency_key: idempotencyKey,
      });
      navigate(clinicId ? `/clinics/${clinicId}/waiting-room` : `/patients/${patientId}/profile`);
      return;
    }
    if (intent === 'inpatient') {
      await inpatientIntake.mutateAsync({
        patient_id: patientId,
        ward_id: wardId,
        encounter_id: null,
        visit_id: null,
        idempotency_key: idempotencyKey,
      });
      navigate('/ward-board');
      return;
    }
    await emergencyIntake.mutateAsync({
      patient_id: patientId,
      clinic_id: clinicId,
      acuity: 'urgent',
      idempotency_key: idempotencyKey,
    });
    navigate('/triage');
  };

  const handleExistingPatient = async (candidate) => {
    const canonicalId = canonicalCandidateId(candidate);
    const recordStatus = candidate?.record_status || 'registered';
    const vitalStatus = candidate?.vital_status || 'presumed_alive';
    if (canonicalId) {
      await startContext(canonicalId);
      return;
    }
    if (intent && (recordStatus !== 'registered' || vitalStatus === 'deceased')) {
      toast.error('This patient record cannot be used for normal intake');
      return;
    }
    const patientId = candidateId(candidate);
    if (!patientId) {
      return;
    }
    await startContext(patientId);
  };

  const candidateActionState = (candidate) => {
    const canonicalId = canonicalCandidateId(candidate);
    const blockedForIntake = intent
      && !canonicalId
      && ((candidate.record_status || 'registered') !== 'registered'
        || (candidate.vital_status || 'presumed_alive') === 'deceased');
    return {
      canonicalId,
      disabled: Boolean(blockedForIntake),
      label: canonicalId
        ? 'Use Canonical Record'
        : intent
          ? 'Use Existing Record'
          : 'Review Profile',
    };
  };

  const registerDistinctPatient = async () => {
    if (!hasLookup) {
      toast.error('Run patient lookup first');
      return;
    }
    if (candidates.length > 0 && !overrideReasonCode.trim()) {
      toast.error('Select a duplicate review reason');
      return;
    }
    const duplicateReview = candidates.length > 0
      ? {
          lookup_id: activeLookupResult.lookup_id,
          decision: 'new_distinct_patient',
          reason_code: overrideReasonCode.trim(),
          reason_note: overrideReasonNote.trim() || null,
        }
      : undefined;
    const patient = await registerMutation.mutateAsync({
      first_name: form.first_name,
      last_name: form.last_name,
      date_of_birth: form.date_of_birth,
      sex: form.sex || 'unknown',
      duplicate_review: duplicateReview,
    });
    const patientId = getPatientId(patient);
    toast.success('Patient record registered');
    if (patientId) {
      await startContext(patientId);
    } else {
      navigate('/patients');
    }
  };

  return {
    contextWarnings: {
      canStartInpatient,
      canStartOutpatient,
    },
    header: {
      title: intentLabel ? `${intentLabel} Patient Intake` : 'Find or Register Patient',
      description: 'Search first to avoid duplicate records. New patients do not need an MRN.',
      onPatientDirectory: () => navigate('/patients'),
    },
    lookupForm: {
      form,
      lookupDisabled,
      lookupPending: lookupMutation.isPending,
      onFieldChange: setField,
      onSubmit: runLookup,
    },
    matchingRecords: {
      candidates,
      interactionState: {
        canOpenChronicle,
        canStartCareContext,
        isBusy,
      },
      lookupState: {
        registrationDetailsAvailable: hasRequiredRegistrationDetails,
        status: lookupStatus,
      },
      onOpenChronicle: navigateToPatientChronicle,
      onUseCandidate: {
        getActionState: candidateActionState,
        handle: handleExistingPatient,
        intent,
      },
    },
    newPatientRegistration: {
      candidates,
      onRegister: registerDistinctPatient,
      overrideReasonCode,
      overrideReasonNote,
      registrationState: {
        canStartCareContext,
        hasLookup,
        hasRequiredDetails: hasRequiredRegistrationDetails,
        isBusy,
      },
      setOverrideReasonCode,
      setOverrideReasonNote,
    },
    pageMeta,
  };
}

export default function FindOrRegisterPatientPage() {
  const workflow = useFindOrRegisterPatientWorkflow();

  return (
    <PageShell>
      {workflow.pageMeta}
      <PageHeader
        title={workflow.header.title}
        description={workflow.header.description}
        actions={(
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={workflow.header.onPatientDirectory}
          >
            Patient Directory
          </Button>
        )}
      />

      <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <PatientLookupForm
          form={workflow.lookupForm.form}
          lookupDisabled={workflow.lookupForm.lookupDisabled}
          lookupPending={workflow.lookupForm.lookupPending}
          onFieldChange={workflow.lookupForm.onFieldChange}
          onSubmit={workflow.lookupForm.onSubmit}
        />

        <section className="space-y-4">
          <IntakeContextWarnings
            canStartInpatient={workflow.contextWarnings.canStartInpatient}
            canStartOutpatient={workflow.contextWarnings.canStartOutpatient}
          />
          <MatchingRecordsPanel
            candidates={workflow.matchingRecords.candidates}
            interactionState={workflow.matchingRecords.interactionState}
            lookupState={workflow.matchingRecords.lookupState}
            onOpenChronicle={workflow.matchingRecords.onOpenChronicle}
            onUseCandidate={workflow.matchingRecords.onUseCandidate}
          />
          <NewPatientRegistrationPanel
            candidates={workflow.newPatientRegistration.candidates}
            onRegister={workflow.newPatientRegistration.onRegister}
            overrideReasonCode={workflow.newPatientRegistration.overrideReasonCode}
            overrideReasonNote={workflow.newPatientRegistration.overrideReasonNote}
            registrationState={workflow.newPatientRegistration.registrationState}
            setOverrideReasonCode={workflow.newPatientRegistration.setOverrideReasonCode}
            setOverrideReasonNote={workflow.newPatientRegistration.setOverrideReasonNote}
          />
        </section>
      </main>
    </PageShell>
  );
}
