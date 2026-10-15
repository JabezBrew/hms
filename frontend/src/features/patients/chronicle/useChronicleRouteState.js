import { useCallback, useMemo, useState } from "react";

import { CHRONICLE_ALL_VISITS, CHRONICLE_VISIT_PARAM } from "./visitScopeUtils";
import { useChronicleRouteActions } from "./useChronicleRouteActions";

export function useChronicleRouteState({
  canUseStandaloneClinicalWorkflows,
  canOpenClinicalActions,
  areEncountersLoading,
  encounters,
  clearQueryParams,
  defaultAction,
  id,
  locationKey,
  openChronicleWorkspace,
  openWardRoundMode,
  patient,
  search,
}) {
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);
  const actionParam = searchParams.get('action');
  const referralIdParam = searchParams.get('referral_id');
  const admissionParam = searchParams.get('admission');
  const noteTypeParam = searchParams.get('note_type');
  const noteTitleParam = searchParams.get('title');
  const visitParam = searchParams.get(CHRONICLE_VISIT_PARAM);
  const chronicleModeParam = searchParams.get('mode');
  const wardRoundParam = searchParams.get('wardRound');
  const consultationParam = searchParams.get('consultation');
  const requestedEncounterReady = !visitParam || visitParam === CHRONICLE_ALL_VISITS
    || (!areEncountersLoading && encounters?.some((encounter) => String(encounter.id) === visitParam));
  const isWardRoundMode = chronicleModeParam === 'ward-round' || defaultAction === 'ward_round';
  const [requestedDischargeAdmission, setRequestedDischargeAdmission] = useState(null);
  const [requestedTreatmentSheetAdmissionId, setRequestedTreatmentSheetAdmissionId] = useState(null);
  const requestedDischargeAdmissionId = requestedDischargeAdmission?.patientId === id
    ? requestedDischargeAdmission.admissionId
    : null;
  const setRequestedDischargeAdmissionId = useCallback((admissionId) => {
    setRequestedDischargeAdmission(admissionId
      ? { patientId: id, admissionId: String(admissionId) }
      : null);
  }, [id]);

  const routeAction = useMemo(() => ({
    intentScope: JSON.stringify([id, visitParam || '', locationKey || '']),
    canOpenClinicalActions: Boolean(canOpenClinicalActions && requestedEncounterReady),
    actionParam,
    admissionParam,
    canUseStandaloneClinicalWorkflows,
    clearQueryParams,
    consultationParam,
    defaultAction,
    openChronicleWorkspace,
    openWardRoundMode,
    noteTitleParam,
    noteTypeParam,
    patient,
    setRequestedDischargeAdmissionId,
    setRequestedTreatmentSheetAdmissionId,
    wardRoundParam,
  }), [
    canOpenClinicalActions,
    id,
    locationKey,
    requestedEncounterReady,
    visitParam,
    actionParam,
    admissionParam,
    canUseStandaloneClinicalWorkflows,
    clearQueryParams,
    consultationParam,
    defaultAction,
    openChronicleWorkspace,
    openWardRoundMode,
    noteTitleParam,
    noteTypeParam,
    patient,
    setRequestedDischargeAdmissionId,
    setRequestedTreatmentSheetAdmissionId,
    wardRoundParam,
  ]);
  useChronicleRouteActions(routeAction);

  return {
    isWardRoundMode,
    referralIdParam,
    requestedDischargeAdmissionId,
    requestedTreatmentSheetAdmissionId,
    setRequestedDischargeAdmissionId,
    setRequestedTreatmentSheetAdmissionId,
    visitParam,
  };
}
