import { useEffect } from "react";
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
  patient,
  setRequestedDischargeAdmissionId,
  setRequestedTreatmentSheetAdmissionId,
  wardRoundParam,
}) {
  const action = actionParam || defaultAction;
  if (action === 'add_note') {
    openChronicleWorkspace('note');
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
      if (!patient && !admissionParam) {
        return;
      }
      toast.error('No active admission found for this patient');
      if (actionParam || admissionParam) clearQueryParams();
      return;
    }

    setRequestedDischargeAdmissionId(String(admissionId));
    if (!canUseStandaloneClinicalWorkflows) {
      if (actionParam || admissionParam) clearQueryParams();
      return;
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
      if (!patient && !admissionParam) {
        return;
      }
      toast.error('No active admission found for this patient');
      if (actionParam || admissionParam) clearQueryParams();
      return;
    }

    setRequestedTreatmentSheetAdmissionId(String(admissionId));
    openChronicleWorkspace('treatmentSheet');
    if (actionParam || admissionParam) clearQueryParams();
  }
}

export function useChronicleRouteActions(routeAction) {
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-event-handler -- Route/default action params are external navigation commands; this effect is the boundary that opens the matching Chronicle workspace once patient context is available.
    handleChronicleRouteAction(routeAction);
  }, [routeAction]);
}
