import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMultipleSlideOvers } from "@/hooks/useSlideOver";
import {
  chronicleWorkspaceIds,
  prefetchChronicleWorkspaceResources,
} from "@/features/patients/chronicle/workspaceRegistry";
import { stripTransientChronicleParams } from "@/features/patients/chronicle/visitScopeUtils";

export function useChronicleWorkspaceRouting({
  id,
  navigate,
  patientLocalId,
  pathname,
  queryClient,
  search,
}) {
  const prefetchedActionsRef = useRef(new Set());
  const rawSlideOvers = useMultipleSlideOvers(chronicleWorkspaceIds);
  const [workspaceOptions, setWorkspaceOptions] = useState(null);

  useEffect(() => {
    prefetchedActionsRef.current = new Set();
  }, [id]);

  const clearQueryParams = useCallback(() => {
    const nextSearch = stripTransientChronicleParams(search);
    if (nextSearch !== search) {
      navigate({ pathname, search: nextSearch }, { replace: true });
    }
  }, [navigate, pathname, search]);

  const prefetchWorkspaceForOpen = useCallback((workspaceId) => {
    prefetchChronicleWorkspaceResources(workspaceId, { patientLocalId, queryClient });
  }, [patientLocalId, queryClient]);

  const openChronicleWorkspace = useCallback((workspaceId, options = null) => {
    prefetchWorkspaceForOpen(workspaceId);
    setWorkspaceOptions(options && typeof options === 'object' ? options : null);
    rawSlideOvers.open(workspaceId);
  }, [prefetchWorkspaceForOpen, rawSlideOvers]);

  const closeChronicleWorkspace = useCallback(() => {
    setWorkspaceOptions(null);
    rawSlideOvers.close();
  }, [rawSlideOvers]);

  const slideOvers = useMemo(() => ({
    ...rawSlideOvers,
    close: closeChronicleWorkspace,
  }), [closeChronicleWorkspace, rawSlideOvers]);

  const openWardRoundMode = useCallback(() => {
    const nextSearchParams = new URLSearchParams(search);
    nextSearchParams.set('mode', 'ward-round');
    nextSearchParams.delete('action');
    nextSearchParams.delete('wardRound');
    navigate({
      pathname: `/patients/${id}`,
      search: `?${nextSearchParams.toString()}`,
    });
  }, [id, navigate, search]);

  const prefetchActionResources = useCallback((action) => {
    if (!action) return;

    const actionToken = `${action}:${patientLocalId || 'none'}`;
    if (prefetchedActionsRef.current.has(actionToken)) {
      return;
    }
    prefetchedActionsRef.current.add(actionToken);
    prefetchChronicleWorkspaceResources(action, { patientLocalId, queryClient });
  }, [patientLocalId, queryClient]);

  return {
    clearQueryParams,
    openChronicleWorkspace,
    openWardRoundMode,
    prefetchActionResources,
    slideOvers,
    workspaceOptions,
  };
}
