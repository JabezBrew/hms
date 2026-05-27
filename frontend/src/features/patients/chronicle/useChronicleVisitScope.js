import { useCallback, useMemo } from "react";

import {
  buildChronicleSearch,
  CHRONICLE_ALL_VISITS,
  CHRONICLE_VISIT_PARAM,
  resolveChronicleVisitScope,
} from "@/features/patients/chronicle/visitScopeUtils";

export function useChronicleVisitScope({
  activeEncounter,
  activeEncounterId,
  areEncountersLoading,
  canFetchClinical,
  encounters,
  formatEncounterScopeLabel,
  navigate,
  pathname,
  rustV2ActiveAdmissionId,
  rustV2Mode,
  search,
  visitParam,
}) {
  const resolvedVisitScope = useMemo(() => resolveChronicleVisitScope({
    requestedVisit: visitParam || (rustV2Mode ? CHRONICLE_ALL_VISITS : undefined),
    activeEncounterId: activeEncounterId || activeEncounter?.id,
    encounters,
    areEncountersLoading,
  }), [
    activeEncounter?.id,
    activeEncounterId,
    areEncountersLoading,
    encounters,
    rustV2Mode,
    visitParam,
  ]);

  const isAllVisitsScope = resolvedVisitScope === CHRONICLE_ALL_VISITS;
  const selectedEncounterId = !resolvedVisitScope || isAllVisitsScope ? null : resolvedVisitScope;
  const isVisitScopePending = canFetchClinical && !resolvedVisitScope;
  const selectedEncounter = useMemo(
    () => encounters?.find((encounter) => String(encounter.id) === String(selectedEncounterId)) || null,
    [encounters, selectedEncounterId],
  );
  const chartContextEncounter = useMemo(() => {
    if (isAllVisitsScope) {
      return null;
    }
    return selectedEncounter || activeEncounter || null;
  }, [activeEncounter, isAllVisitsScope, selectedEncounter]);
  const chartContextAdmissionId = chartContextEncounter?.admission_id
    || chartContextEncounter?.admission?.id
    || rustV2ActiveAdmissionId
    || null;

  const visitScopeOptions = useMemo(() => {
    const options = [{
      value: CHRONICLE_ALL_VISITS,
      label: 'All history',
    }];

    if (!Array.isArray(encounters)) {
      return options;
    }

    return options.concat(
      encounters.map((encounter) => ({
        value: String(encounter.id),
        label: formatEncounterScopeLabel(encounter, activeEncounter?.id),
      })),
    );
  }, [activeEncounter?.id, encounters, formatEncounterScopeLabel]);

  const visitScopeRedirectSearch = useMemo(() => {
    if (!visitParam || !resolvedVisitScope || visitParam === resolvedVisitScope) {
      return null;
    }

    return buildChronicleSearch(search, {
      updates: {
        [CHRONICLE_VISIT_PARAM]: resolvedVisitScope,
      },
    });
  }, [resolvedVisitScope, search, visitParam]);

  const handleVisitScopeChange = useCallback((nextVisitScope) => {
    const nextSearch = buildChronicleSearch(search, {
      updates: {
        [CHRONICLE_VISIT_PARAM]: nextVisitScope,
      },
    });

    navigate({ pathname, search: nextSearch }, { replace: true });
  }, [navigate, pathname, search]);

  const handleViewAllHistory = useCallback(() => {
    handleVisitScopeChange(CHRONICLE_ALL_VISITS);
  }, [handleVisitScopeChange]);

  const handleViewCurrentVisit = useCallback(() => {
    if (!activeEncounter?.id) {
      return;
    }

    handleVisitScopeChange(String(activeEncounter.id));
  }, [activeEncounter?.id, handleVisitScopeChange]);

  const chronicleVisitState = useMemo(() => ({
    isAllVisitsScope,
    resolvedVisitScope,
    selectedEncounterId,
  }), [isAllVisitsScope, resolvedVisitScope, selectedEncounterId]);

  return {
    chartContextAdmissionId,
    chartContextEncounter,
    chronicleVisitState,
    handleViewAllHistory,
    handleViewCurrentVisit,
    handleVisitScopeChange,
    isAllVisitsScope,
    isVisitScopePending,
    resolvedVisitScope,
    selectedEncounter,
    selectedEncounterId,
    visitScopeRedirectSearch,
    visitScopeOptions,
  };
}
