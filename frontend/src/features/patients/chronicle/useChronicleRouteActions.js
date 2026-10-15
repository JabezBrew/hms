import { useEffect, useRef } from "react";
import { toast } from "sonner";

function handleChronicleRouteAction({
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
}) {
  const action = actionParam || defaultAction;
  if (action === 'add_note' || action === 'note') {
    const noteDraft = noteTitleParam || noteTypeParam
      ? {
          title: noteTitleParam || undefined,
          noteType: noteTypeParam || undefined,
        }
      : null;
    openChronicleWorkspace('note', noteDraft ? { noteDraft } : null);
    if (actionParam || noteTitleParam || noteTypeParam) clearQueryParams();
  } else if (action === 'vitals' || action === 'record_vitals' || action === 'add_vitals') {
    openChronicleWorkspace('vitals');
    if (actionParam) clearQueryParams();
  } else if (action === 'fluids' || action === 'fluid_balance' || action === 'record_fluids') {
    openChronicleWorkspace('fluids');
    if (actionParam) clearQueryParams();
  } else if (action === 'medication_history' || action === 'mar') {
    openChronicleWorkspace('medicationHistory');
    if (actionParam) clearQueryParams();
  } else if (action === 'ward_round' || wardRoundParam === 'true') {
    if (actionParam || wardRoundParam) {
      openWardRoundMode();
    }
  } else if (action === 'consultation' || consultationParam === 'true') {
    openChronicleWorkspace('consultation');
    if (actionParam || consultationParam) clearQueryParams();
  } else if (action === 'discharge') {
    const admissionId = admissionParam
      || patient?.local_data?.current_admission_id
      || patient?.current_admission_id;

    if (!admissionId) {
      if (!patient && !admissionParam) return false;
      toast.error('No active admission found for this patient');
      if (actionParam || admissionParam) clearQueryParams();
      return true;
    }

    setRequestedDischargeAdmissionId(String(admissionId));
    if (!canUseStandaloneClinicalWorkflows) {
      if (actionParam || admissionParam) clearQueryParams();
      return true;
    }
    openChronicleWorkspace('discharge');
    if (actionParam || admissionParam) clearQueryParams();
  } else if (action === 'add_prescription') {
    openChronicleWorkspace('prescription');
    if (actionParam) clearQueryParams();
  } else if (action === 'treatment_sheet') {
    const admissionId = admissionParam
      || patient?.local_data?.current_admission_id
      || patient?.current_admission_id;

    if (!admissionId) {
      if (!patient && !admissionParam) return false;
      toast.error('No active admission found for this patient');
      if (actionParam || admissionParam) clearQueryParams();
      return true;
    }

    setRequestedTreatmentSheetAdmissionId(String(admissionId));
    openChronicleWorkspace('treatmentSheet');
    if (actionParam || admissionParam) clearQueryParams();
  } else {
    return false;
  }
  return true;
}

export function useChronicleRouteActions(routeAction) {
  const consumedIntent = useRef(null);
  useEffect(() => {
    const action = routeAction.actionParam || routeAction.defaultAction;
    const hasIntent = action || routeAction.wardRoundParam === 'true' || routeAction.consultationParam === 'true';
    if (!hasIntent) {
      consumedIntent.current = null;
      return;
    }
    if (!routeAction.canOpenClinicalActions) return;
    const intent = JSON.stringify([
      routeAction.intentScope, action, routeAction.admissionParam,
      routeAction.noteTitleParam, routeAction.noteTypeParam,
      routeAction.wardRoundParam, routeAction.consultationParam,
    ]);
    if (consumedIntent.current === intent) return;
    // Navigation cleanup can be deferred by the router. Claim the command
    // before opening stateful UI so unstable callbacks cannot replay it.
    consumedIntent.current = intent;
    // react-doctor-disable-next-line react-doctor/no-event-handler -- Route/default action params are external navigation commands; this effect is the boundary that opens the matching Chronicle workspace once patient context is available.
    if (!handleChronicleRouteAction(routeAction)) consumedIntent.current = null;
  }, [routeAction]);
}
