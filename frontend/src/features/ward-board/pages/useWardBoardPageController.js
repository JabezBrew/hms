import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useDebounce } from '@/hooks/use-debounce';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { useAfterInitialPaint } from '@/shared/hooks/useAfterInitialPaint';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { useRouteTableState } from '@/shared/hooks/useRouteTableState';
import {
  BOARD_VIEWS,
  DEFAULT_BOARD_VIEW,
  DEFAULT_PAGE_SIZE,
  compactParams,
  getBoardPatients,
  getBoardSummary,
  getPatientBed,
  getPatientId,
  getPatientMrn,
  getPatientWardName,
} from '@/features/ward-board/components';
import {
  useWardBoard,
  useWardBoardContext,
  useWardBoardLiveUpdates,
  useWardBoardTaskAction,
} from '@/features/ward-board/hooks';

const VIEW_VALUES = new Set(BOARD_VIEWS.map((view) => view.value));
function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function rowPatientKey(patient, index) {
  return getPatientId(patient) ?? `row-${index}`;
}

function assignedWardName(assignedWards, wardId) {
  if (!wardId) {
    return null;
  }
  return assignedWards.find((assignment) => assignment?.ward_id === wardId)?.ward_name ?? null;
}

function routeStateWithPrivateFilters(locationState, filters) {
  const search = filters?.search || '';
  const patient = filters?.patient || '';
  if (!search && !patient) {
    return locationState;
  }
  return {
    ...(locationState || {}),
    'wardBoard:privateFilters': {
      search,
      patient,
    },
  };
}

export function useWardBoardPageController() {
  const rustV2Mode = isRustV2ApiMode();
  const { wardId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const locationPathname = location.pathname;
  const locationSearch = location.search;
  const locationHash = location.hash;
  const locationStateRef = useRef(location.state);
  locationStateRef.current = location.state;
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  const fixedWard = wardId || '';
  const queryWard = searchParams.get('ward') || '';
  const effectiveWard = fixedWard || queryWard;
  const allWardScope = !fixedWard && searchParams.get('scope') === 'all';
  const viewParam = searchParams.get('view') || DEFAULT_BOARD_VIEW;
  const view = VIEW_VALUES.has(viewParam) ? viewParam : DEFAULT_BOARD_VIEW;
  const page = parsePositiveInt(searchParams.get('page'), 1);
  const pageSize = parsePositiveInt(searchParams.get('page_size'), DEFAULT_PAGE_SIZE);
  const legacySearchParam = searchParams.get('search') || '';
  const legacyPatientParam = searchParams.get('patient') || '';
  const [privateFilters, setPrivateFilters] = useRouteTableState('wardBoard:privateFilters', {
    search: legacySearchParam,
    patient: legacyPatientParam,
  });
  const searchParam = privateFilters.search || '';
  const queryPatient = privateFilters.patient || '';
  const preservedPrivateFilters = useMemo(() => ({
    search: searchParam || legacySearchParam,
    patient: queryPatient || legacyPatientParam,
  }), [legacyPatientParam, legacySearchParam, queryPatient, searchParam]);
  const debouncedSearch = useDebounce(searchParam, 300);

  const pageMeta = usePageMeta({
    title: 'Ward Board | Hospital Management System',
    breadcrumbs: fixedWard
      ? [
          { label: 'Wards', path: '/wards' },
          { label: 'Board', path: `/wards/${fixedWard}/board` },
        ]
      : [{ label: 'Ward Board', path: '/ward-board' }],
  });

  const updateParams = useCallback((changes, { resetPage = true, replace = true } = {}) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('search');
      next.delete('patient');
      Object.entries(changes).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      });
      if (fixedWard) {
        next.delete('ward');
      }
      if (resetPage) {
        next.set('page', '1');
      }
      return next;
    }, { replace });
  }, [fixedWard, setSearchParams]);

  const {
    data: boardContext,
    isLoading: isContextLoading,
    isError: isContextError,
    error: contextError,
    refetch: refetchContext,
  } = useWardBoardContext({
    enabled: rustV2Mode,
  });

  useEffect(() => {
    if (!rustV2Mode || fixedWard || allWardScope || queryWard || !boardContext?.default_ward_id) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('ward');
    nextParams.delete('scope');
    nextParams.delete('search');
    nextParams.delete('patient');
    nextParams.set('page', '1');
    const nextSearch = nextParams.toString();
    navigate(`/wards/${boardContext.default_ward_id}/board${nextSearch ? `?${nextSearch}` : ''}`, {
      replace: true,
      state: routeStateWithPrivateFilters(locationStateRef.current, preservedPrivateFilters),
      preventScrollReset: true,
    });
  }, [
    allWardScope,
    boardContext?.default_ward_id,
    fixedWard,
    navigate,
    preservedPrivateFilters,
    queryWard,
    rustV2Mode,
    searchParams,
  ]);

  useEffect(() => {
    if (!legacySearchParam && !legacyPatientParam) {
      return;
    }
    const nextParams = new URLSearchParams(locationSearch);
    nextParams.delete('search');
    nextParams.delete('patient');
    const nextSearch = nextParams.toString();
    navigate(`${locationPathname}${nextSearch ? `?${nextSearch}` : ''}${locationHash}`, {
      replace: true,
      state: routeStateWithPrivateFilters(locationStateRef.current, preservedPrivateFilters),
      preventScrollReset: true,
    });
  }, [
    legacyPatientParam,
    legacySearchParam,
    locationHash,
    locationPathname,
    locationSearch,
    navigate,
    preservedPrivateFilters,
  ]);

  const queryFilters = useMemo(() => compactParams({
    ward: effectiveWard,
    scope: allWardScope ? 'all' : '',
    patient: queryPatient,
    view,
    search: debouncedSearch.trim(),
    page,
    page_size: pageSize,
  }), [allWardScope, debouncedSearch, effectiveWard, page, pageSize, queryPatient, view]);

  const canLoadAllWardBoard = !rustV2Mode || Boolean(boardContext?.can_view_all_wards);
  const shouldLoadBoard = Boolean(
    fixedWard
    || effectiveWard
    || !rustV2Mode
    || (allWardScope && canLoadAllWardBoard)
  );

  const {
    data: boardData,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useWardBoard(queryFilters, {
    enabled: shouldLoadBoard,
  });

  const patients = useMemo(() => getBoardPatients(boardData), [boardData]);
  const summary = useMemo(() => getBoardSummary(boardData, patients), [boardData, patients]);
  const assignedWards = useMemo(
    () => (Array.isArray(boardContext?.assigned_wards) ? boardContext.assigned_wards : []),
    [boardContext?.assigned_wards]
  );
  const firstPatientWardName = useMemo(
    () => patients.map((patient) => getPatientWardName(patient)).find(Boolean) ?? null,
    [patients]
  );
  const currentWardLabel = allWardScope
    ? 'All inpatient wards'
    : assignedWardName(assignedWards, effectiveWard) || firstPatientWardName || (effectiveWard ? `Ward ${effectiveWard}` : 'Ward Board');
  const selectedPatient = useMemo(() => {
    if (selectedPatientId == null) {
      return null;
    }
    return patients.find((patient, index) => rowPatientKey(patient, index) === selectedPatientId) ?? null;
  }, [patients, selectedPatientId]);
  const selectedPatientContext = selectedPatient
    ? [getPatientBed(selectedPatient), getPatientWardName(selectedPatient), getPatientMrn(selectedPatient)]
        .filter(Boolean)
        .join(' · ')
    : '';
  const totalCount = boardData?.count ?? patients.length;
  const resolvedPage = Number(boardData?.page || page);

  useEffect(() => {
    if (boardData?.cursor_missing && resolvedPage !== page) {
      updateParams({ page: resolvedPage }, { resetPage: false });
    }
  }, [boardData?.cursor_missing, page, resolvedPage, updateParams]);

  const showBoardBody = useAfterInitialPaint({
    enabled: Boolean(boardData && !isLoading),
    minimumDelayMs: 200,
    timeoutMs: 400,
  });
  const taskMutation = useWardBoardTaskAction();
  const { isConnected: isLiveConnected } = useWardBoardLiveUpdates({
    enabled: shouldLoadBoard && !isLoading,
    wardScope: allWardScope ? 'all' : (effectiveWard || 'all'),
  });

  const handleTaskAction = useCallback(({ taskId, action, patientId }) => {
    setPendingAction({ taskId, action });
    taskMutation.mutate(
      { taskId, action, patientId, payload: {} },
      {
        onSuccess: () => {
          toast.success('Ward board task updated');
        },
        onError: (mutationError) => {
          toast.error(mutationError?.message || 'Unable to update ward board task');
        },
        onSettled: () => {
          setPendingAction(null);
        },
      }
    );
  }, [taskMutation]);

  const handleSearchChange = useCallback((nextSearch) => {
    setPrivateFilters((current) => ({
      ...current,
      search: nextSearch,
    }));
    if (page !== 1) {
      updateParams({}, { resetPage: true });
    }
  }, [page, setPrivateFilters, updateParams]);

  const handleOpenPatientDetail = useCallback((patientId) => {
    if (patientId == null) {
      return;
    }
    setSelectedPatientId(patientId);
  }, []);

  const handleClearFilters = useCallback(() => {
    setPrivateFilters((current) => ({
      ...current,
      search: '',
      patient: '',
    }));
    updateParams({}, { resetPage: true });
  }, [setPrivateFilters, updateParams]);

  const handleViewChange = useCallback((nextView) => {
    updateParams({ view: nextView }, { resetPage: true });
  }, [updateParams]);

  const handleWardChange = useCallback((nextWard) => {
    updateParams({ ward: nextWard.trim() }, { resetPage: true });
  }, [updateParams]);

  const handlePageSizeChange = useCallback((nextPageSize) => {
    updateParams({ page_size: nextPageSize }, { resetPage: true });
  }, [updateParams]);

  const handlePageChange = useCallback((nextPage) => {
    updateParams({ page: nextPage }, { resetPage: false });
  }, [updateParams]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleOpenSummary = useCallback(() => {
    setSummaryOpen((value) => !value);
  }, []);

  const handleHandoverMode = useCallback(() => {
    updateParams({ view: 'by-urgency' }, { resetPage: true });
  }, [updateParams]);

  const handleDetailSheetOpenChange = useCallback((open) => {
    if (!open) {
      setSelectedPatientId(null);
    }
  }, []);

  const handleOpenAssignedWard = useCallback((nextWardId) => {
    if (!nextWardId) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('ward');
    nextParams.delete('scope');
    nextParams.delete('search');
    nextParams.delete('patient');
    nextParams.set('page', '1');
    const nextSearch = nextParams.toString();
    navigate(`/wards/${nextWardId}/board${nextSearch ? `?${nextSearch}` : ''}`, {
      replace: false,
      state: routeStateWithPrivateFilters(locationStateRef.current, preservedPrivateFilters),
      preventScrollReset: true,
    });
  }, [navigate, preservedPrivateFilters, searchParams]);

  const handleOpenAllWards = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('ward');
    nextParams.delete('search');
    nextParams.delete('patient');
    nextParams.set('scope', 'all');
    nextParams.set('page', '1');
    const nextSearch = nextParams.toString();
    navigate(`/ward-board${nextSearch ? `?${nextSearch}` : ''}`, {
      replace: false,
      state: routeStateWithPrivateFilters(locationStateRef.current, preservedPrivateFilters),
      preventScrollReset: true,
    });
  }, [navigate, preservedPrivateFilters, searchParams]);

  if (rustV2Mode && !fixedWard && isContextLoading && !boardContext) {
    return { status: 'context-loading', pageMeta };
  }

  if (rustV2Mode && !fixedWard && isContextError && !boardContext) {
    return {
      status: 'context-error',
      pageMeta,
      error: contextError,
      onRetry: refetchContext,
    };
  }

  if (rustV2Mode && allWardScope && !canLoadAllWardBoard) {
    return { status: 'all-ward-denied', pageMeta };
  }

  if (!shouldLoadBoard) {
    return {
      status: 'resolver',
      pageMeta,
      boardContext,
      onOpenAssignedWard: handleOpenAssignedWard,
      onOpenAllWards: handleOpenAllWards,
    };
  }

  if (isLoading && !boardData) {
    return { status: 'board-loading', pageMeta };
  }

  if (isError && !boardData) {
    return {
      status: 'board-error',
      pageMeta,
      error,
      onRetry: refetch,
    };
  }

  return {
    status: 'ready',
    pageMeta,
    board: {
      allWardScope,
      assignedWards,
      boardData,
      currentWardLabel,
      effectiveWard,
      error,
      fixedWard,
      isError,
      isFetching,
      isLiveConnected,
      orderedPatients: patients,
      pageSize,
      pendingAction,
      queryPatient,
      resolvedPage,
      rustV2Mode,
      searchParam,
      selectedPatient,
      selectedPatientContext,
      selectedPatientId,
      showBoardBody,
      summary,
      summaryOpen,
      totalCount,
      view,
    },
    actions: {
      handleClearFilters,
      handleDetailSheetOpenChange,
      handleHandoverMode,
      handleOpenAssignedWard,
      handleOpenPatientDetail,
      handleOpenSummary,
      handlePageChange,
      handlePageSizeChange,
      handleRefresh,
      handleSearchChange,
      handleSummaryOpenChange: setSummaryOpen,
      handleTaskAction,
      handleViewChange,
      handleWardChange,
    },
  };
}
