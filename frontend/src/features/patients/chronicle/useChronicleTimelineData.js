import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  patientKeys,
  usePatientChronicleTimeline,
} from "@/features/patients/hooks/usePatientQueries";
import {
  useInvalidateTimeline,
  usePatientTimeline,
} from "@/hooks/useTimelineQueries";

const CHRONICLE_TYPE_MAPPING = {
  all: 'all',
  progress_note: 'notes',
  vitals: 'vitals',
  medication: 'prescriptions',
  lab_result: 'labs',
};

function hasSeedableTimelinePage(page) {
  return Array.isArray(page?.results) && page.results.length > 0;
}

function hasTimelinePageResults(data) {
  return Array.isArray(data?.pages) && data.pages.some(hasSeedableTimelinePage);
}

function buildTimelineDataFromInitialPage(page) {
  if (!hasSeedableTimelinePage(page)) {
    return null;
  }

  return {
    pageParams: [null],
    pages: [page],
  };
}

export function useChronicleTimelineData({
  activeFilter,
  canFetchClinical,
  chronicleContext,
  debouncedSearch,
  isWardRoundMode,
  patientId,
  resolvedVisitScope,
  rustV2Mode,
  selectedEncounterId,
}) {
  const queryClient = useQueryClient();
  const invalidateTimeline = useInvalidateTimeline();
  const loadMoreRef = useRef(null);
  const appliedTimelineSeedRef = useRef(null);

  const chronicleTimelineParams = useMemo(() => ({
    type: CHRONICLE_TYPE_MAPPING[activeFilter] || 'all',
    search: debouncedSearch,
    limit: 20,
    encounterId: selectedEncounterId || undefined,
  }), [activeFilter, debouncedSearch, selectedEncounterId]);

  const canSeedRustTimeline = rustV2Mode
    && chronicleTimelineParams.type === 'all'
    && !chronicleTimelineParams.search
    && !chronicleTimelineParams.encounterId
    && hasSeedableTimelinePage(chronicleContext?.timeline);

  const rustTimelineQuery = usePatientChronicleTimeline(patientId, chronicleTimelineParams, {
    enabled: !isWardRoundMode && rustV2Mode && canFetchClinical && !!resolvedVisitScope && !!chronicleContext && !canSeedRustTimeline,
    initialPage: canSeedRustTimeline ? chronicleContext.timeline : undefined,
  });
  const legacyTimelineQuery = usePatientTimeline(patientId, {
    type: chronicleTimelineParams.type,
    search: chronicleTimelineParams.search,
    pageSize: chronicleTimelineParams.limit,
    encounterId: chronicleTimelineParams.encounterId,
    enabled: !isWardRoundMode && !rustV2Mode && canFetchClinical && !!resolvedVisitScope,
  });
  const activeTimelineQuery = rustV2Mode ? rustTimelineQuery : legacyTimelineQuery;
  const {
    data: timelineData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isTimelineLoading,
    refetch: refetchTimeline,
  } = activeTimelineQuery;

  const seededRustTimelineData = useMemo(
    () => buildTimelineDataFromInitialPage(canSeedRustTimeline ? chronicleContext?.timeline : null),
    [canSeedRustTimeline, chronicleContext?.timeline],
  );
  const timelineDisplayData = useMemo(() => {
    if (seededRustTimelineData && !hasTimelinePageResults(timelineData)) {
      return seededRustTimelineData;
    }

    return timelineData;
  }, [seededRustTimelineData, timelineData]);
  const timelineSeedGeneration = chronicleContext?.generated_at ?? chronicleContext?.timeline;

  useEffect(() => {
    if (!patientId || !seededRustTimelineData) {
      return;
    }
    if (appliedTimelineSeedRef.current?.patientId === patientId
      && appliedTimelineSeedRef.current.generation === timelineSeedGeneration) {
      return;
    }
    appliedTimelineSeedRef.current = { patientId, generation: timelineSeedGeneration };

    const queryKey = patientKeys.chronicleTimeline(patientId, chronicleTimelineParams);
    const current = queryClient.getQueryData(queryKey);
    const queryState = queryClient.getQueryState(queryKey);
    const hasLoadedHistory = Array.isArray(current?.pages) && current.pages.length > 1;
    // Each fresh startup response refreshes loaded history once. Pagination can
    // clear isInvalidated before startup returns, so that flag is not durable.
    if (hasLoadedHistory || queryState?.fetchStatus === 'fetching') {
      void refetchTimeline({ cancelRefetch: true });
      return;
    }
    queryClient.setQueryData(
      queryKey,
      seededRustTimelineData,
    );
  }, [chronicleTimelineParams, patientId, queryClient, refetchTimeline, seededRustTimelineData, timelineSeedGeneration]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );

    if (loadMoreRef.current) {
      // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent -- IntersectionObserver observes a DOM sentinel; no React parent callback or lifted state is involved.
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return {
    fetchNextPage,
    hasNextPage,
    invalidateTimeline,
    isFetchingNextPage,
    isTimelineLoading,
    loadMoreRef,
    refetchTimeline,
    timelineDisplayData,
  };
}
