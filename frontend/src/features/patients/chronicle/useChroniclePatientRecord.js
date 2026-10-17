import { useEffect, useMemo, useState } from "react";

import { usePatientInsurance } from "@/features/billing/hooks";
import { usePatientEncounters } from "@/features/encounters/hooks/useEncounterQueries";
import {
  usePatient,
  usePatientChronicleStartup,
} from "@/features/patients/hooks/usePatientQueries";
import { useChronicleContext } from "@/hooks/useChronicleContext";
import { usePageMeta } from "@/shared/hooks/usePageMeta";
import { resolvePatientDisplayName } from "@/features/patients/utils/resolvePatientDisplayName";

import {
  findActiveChronicleEncounter,
  mergeRustV2Encounters,
  resolveChronicleActiveAdmission,
} from "./chronicleEncounterUtils";

function shapePatientForChronicle({ patient, rustV2ActiveAdmission, rustV2ActiveAdmissionId }) {
  if (!patient || !rustV2ActiveAdmissionId) {
    return patient;
  }

  const localData = patient.local_data || {};
  const authoritative = Number.isSafeInteger(rustV2ActiveAdmission?.placement_revision) && rustV2ActiveAdmission.placement_revision >= 0;
  const wardId = authoritative ? rustV2ActiveAdmission.ward_id ?? null : patient.current_ward_id || rustV2ActiveAdmission?.ward_id || null;
  const ward = authoritative ? rustV2ActiveAdmission.ward_name ?? null : patient.current_ward || rustV2ActiveAdmission?.ward_name || null;
  const bed = authoritative ? rustV2ActiveAdmission.bed_code ?? rustV2ActiveAdmission.bed_number ?? null : patient.current_bed || rustV2ActiveAdmission?.bed_code || rustV2ActiveAdmission?.bed_number || null;
  return {
    ...patient,
    current_admission_id: authoritative ? rustV2ActiveAdmissionId : patient.current_admission_id || rustV2ActiveAdmissionId,
    current_ward_id: wardId,
    current_ward: ward,
    current_bed: bed,
    local_data: {
      ...localData,
      current_admission_id: authoritative ? rustV2ActiveAdmissionId : localData.current_admission_id || rustV2ActiveAdmissionId,
      current_ward_id: authoritative ? wardId : localData.current_ward_id || wardId,
      current_ward: authoritative ? ward : localData.current_ward || ward,
      current_bed: authoritative ? bed : localData.current_bed || bed,
    },
  };
}

export function useChroniclePatientRecord({ id, rustV2Mode }) {
  const [authorizedMount, setAuthorizedMount] = useState({ id, verified: false });
  const {
    data: cachedStartup,
    isLoading: isStartupLoading,
    isFetchedAfterMount,
    error: startupError,
    refetch: refetchStartup,
  } = usePatientChronicleStartup(id, {}, {
    enabled: rustV2Mode,
    refetchOnMount: 'always',
  });

  // A cached clinical view cannot prove that a previous emergency grant still
  // authorizes this mount. Wait for the server and preserve any fresh denial.
  // Keep the mounted proof through later query resets: TanStack resets its
  // update counters, which can make isFetchedAfterMount false again.
  useEffect(() => {
    setAuthorizedMount((current) => {
      if (current.id === id && current.verified) return current;
      const verified = Boolean(isFetchedAfterMount && !startupError && cachedStartup);
      return current.id === id && current.verified === verified ? current : { id, verified };
    });
  }, [id, isFetchedAfterMount, startupError, cachedStartup]);
  const verifiedMount = authorizedMount.id === id && authorizedMount.verified;
  const awaitingStartupAuthorization = rustV2Mode && !verifiedMount && isFetchedAfterMount === false && !startupError;
  const chronicleStartup = awaitingStartupAuthorization || startupError ? undefined : cachedStartup;

  const {
    data: legacyPatient,
    isLoading: isPatientLoading,
    error: patientError,
    refetch: refetchPatient,
  } = usePatient(id, {
    enabled: !rustV2Mode,
  });

  const patient = rustV2Mode ? chronicleStartup?.patient : legacyPatient;
  const isLoading = rustV2Mode ? isStartupLoading || awaitingStartupAuthorization : isPatientLoading;
  const error = rustV2Mode ? startupError : patientError;
  const patientName = useMemo(() => resolvePatientDisplayName(patient), [patient]);
  const patientPath = id ? `/patients/${id}/chronicle` : '/patients';
  const pageMeta = usePageMeta({
    title: patientName
      ? `${patientName} Chronicle | Hospital Management System`
      : 'Patient Chronicle | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: patientName || 'Patient Chronicle', path: patientPath },
    ],
  });

  const hasClinicalAccess = rustV2Mode
    ? Boolean(chronicleStartup) && !startupError
    : patient?.access?.clinical === true;
  const patientLocalId = patient?.local_data?.id || patient?.id || id;
  const patientIdentityId = patient?.local_data?.patient_identity_id || patient?.patient_identity_id || null;
  const rustV2ActiveAdmission = rustV2Mode
    ? chronicleStartup?.active_admission || chronicleStartup?.active_context?.admission || null
    : null;
  const rustV2ActiveAdmissionId = rustV2Mode
    ? rustV2ActiveAdmission?.admission_id || rustV2ActiveAdmission?.id || null
    : null;
  const patientForChronicle = useMemo(() => (
    shapePatientForChronicle({ patient, rustV2ActiveAdmission, rustV2ActiveAdmissionId })
  ), [
    patient,
    rustV2ActiveAdmission,
    rustV2ActiveAdmissionId,
  ]);

  const {
    data: legacyChronicleContext,
    isLoading: isLegacyContextLoading,
    error: legacyContextError,
    refetch: refetchLegacyContext,
  } = useChronicleContext(id, {
    enabled: !rustV2Mode && hasClinicalAccess,
  });

  const chronicleContext = rustV2Mode ? chronicleStartup : legacyChronicleContext;
  const isContextLoading = rustV2Mode ? false : isLegacyContextLoading;
  const contextError = rustV2Mode ? startupError : legacyContextError;
  const refetchContext = rustV2Mode ? refetchStartup : refetchLegacyContext;

  const canFetchClinical = hasClinicalAccess;
  const {
    data: legacyEncounters,
    isLoading: areLegacyEncountersLoading,
    refetch: refetchEncounters,
  } = usePatientEncounters(id, {
    enabled: !rustV2Mode && canFetchClinical,
  });
  const rustV2Encounters = useMemo(
    () => mergeRustV2Encounters(chronicleContext),
    [chronicleContext],
  );
  const encounters = rustV2Mode ? rustV2Encounters : legacyEncounters;
  const areEncountersLoading = rustV2Mode ? false : areLegacyEncountersLoading;
  const activeEncounter = useMemo(
    () => findActiveChronicleEncounter(encounters),
    [encounters],
  );
  const chronicleActiveAdmission = useMemo(() => (
    resolveChronicleActiveAdmission({ activeEncounter, rustV2ActiveAdmission })
  ), [activeEncounter, rustV2ActiveAdmission]);

  const { data: insuranceData } = usePatientInsurance(id, {}, {
    enabled: !rustV2Mode && hasClinicalAccess,
  });
  const patientInsurance = insuranceData?.results || insuranceData || [];

  return {
    activeEncounter,
    areEncountersLoading,
    canFetchClinical,
    chronicleActiveAdmission,
    chronicleContext,
    chronicleStartup,
    contextError,
    encounters,
    error,
    hasClinicalAccess,
    isContextLoading,
    isLoading,
    pageMeta,
    patient,
    patientForChronicle,
    patientIdentityId,
    patientInsurance,
    patientLocalId,
    patientName,
    refetchContext,
    refetchEncounters,
    refetchPatient,
    refetchStartup,
    rustV2ActiveAdmissionId,
    startupError,
  };
}
