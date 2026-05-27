import { useEffect, useRef } from "react";

import { emitOnboardingEvent } from "@/features/onboarding";

export function useChronicleOnboardingEvents({
  activeFilter,
  hasClinicalAccess,
  patientLocalId,
}) {
  const openedPatientChartsRef = useRef(new Set());
  const lastFilterEventRef = useRef(null);

  useEffect(() => {
    if (!hasClinicalAccess || !patientLocalId) {
      return;
    }
    if (openedPatientChartsRef.current.has(patientLocalId)) {
      return;
    }
    openedPatientChartsRef.current.add(patientLocalId);
    emitOnboardingEvent('patients.chart_opened', {
      success: true,
      patient_id: patientLocalId,
    });
  }, [hasClinicalAccess, patientLocalId]);

  useEffect(() => {
    if (!patientLocalId) {
      return;
    }
    const token = `${patientLocalId}:${activeFilter}`;
    if (lastFilterEventRef.current === token) {
      return;
    }
    lastFilterEventRef.current = token;
    emitOnboardingEvent('chronicle.filter_changed', {
      filter: activeFilter,
      patient_id: patientLocalId,
    });
  }, [activeFilter, patientLocalId]);
}
