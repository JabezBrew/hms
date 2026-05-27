import { useMemo } from "react";

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
  return {
    ...patient,
    current_admission_id: patient.current_admission_id || rustV2ActiveAdmissionId,
    current_ward_id: patient.current_ward_id || rustV2ActiveAdmission?.ward_id || null,
    current_ward: patient.current_ward || rustV2ActiveAdmission?.ward_name || null,
    current_bed: patient.current_bed || rustV2ActiveAdmission?.bed_code || rustV2ActiveAdmission?.bed_number || null,
    local_data: {
      ...localData,
      current_admission_id: localData.current_admission_id || rustV2ActiveAdmissionId,
      current_ward_id: localData.current_ward_id || rustV2ActiveAdmission?.ward_id || null,
      current_ward: localData.current_ward || rustV2ActiveAdmission?.ward_name || null,
      current_bed: localData.current_bed || rustV2ActiveAdmission?.bed_code || rustV2ActiveAdmission?.bed_number || null,
    },
  };
}

export function useChroniclePatientRecord({ id, rustV2Mode }) {
  const {
    data: chronicleStartup,
    isLoading: isStartupLoading,
    error: startupError,
    refetch: refetchStartup,
  } = usePatientChronicleStartup(id, {}, {
    enabled: rustV2Mode,
  });

  const {
    data: legacyPatient,
    isLoading: isPatientLoading,
    error: patientError,
    refetch: refetchPatient,
  } = usePatient(id, {
    enabled: !rustV2Mode,
  });

  const patient = rustV2Mode ? chronicleStartup?.patient : legacyPatient;
  const isLoading = rustV2Mode ? isStartupLoading : isPatientLoading;
  const error = rustV2Mode ? startupError : patientError;
  const patientName = useMemo(() => resolvePatientDisplayName(patient), [patient]);
  const patientPath = id ? `/patients/${id}` : '/patients';
  const pageMeta = usePageMeta({
    title: patientName ? `${patientName} | Hospital Management System` : 'Patient | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: patientName || 'Patient', path: patientPath },
    ],
  });

  const hasClinicalAccess = rustV2Mode
    ? startupError?.status !== 403
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
