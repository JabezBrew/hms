import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { useEncounters } from '@/features/encounters/hooks/useEncounterQueries';
import { useRouteTableState } from '@/shared/hooks/useRouteTableState';
import {
  ENCOUNTER_PAGE_SIZE,
  INITIAL_ENCOUNTER_FILTERS,
  ENCOUNTER_TABS,
  RUST_V2_ENCOUNTER_TABS,
  RUST_V2_ENCOUNTER_STATUS_OPTIONS,
  RUST_V2_ENCOUNTER_TYPE_OPTIONS,
} from './encounterListConstants';
import {
  buildEncounterQueryParams,
  hasActiveEncounterFilters,
} from './encounterListUtils';

export function useEncounterListController() {
  const navigate = useNavigate();
  const rustV2Mode = isRustV2ApiMode();
  const [persistedEncounterState, setPersistedEncounterState] = useRouteTableState('encounters:listTable', {
    activeTab: 'all',
    currentPage: 1,
    filters: INITIAL_ENCOUNTER_FILTERS,
  });
  const [activeTab, setActiveTab] = useState(persistedEncounterState.activeTab || 'all');
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(persistedEncounterState.currentPage || 1);
  const [filters, setFilters] = useState({
    ...INITIAL_ENCOUNTER_FILTERS,
    ...(persistedEncounterState.filters || {}),
  });

  const queryParams = useMemo(
    () => buildEncounterQueryParams({ activeTab, currentPage, filters, rustV2Mode }),
    [activeTab, currentPage, filters, rustV2Mode]
  );

  const {
    data: encountersData,
    isLoading,
    isError,
    error,
    refetch
  } = useEncounters(queryParams);

  const encounters = encountersData?.results || [];
  const totalCount = encountersData?.count || 0;
  const countExact = encountersData?.count_exact ?? true;
  const resolvedPage = Number(encountersData?.page || currentPage);
  const totalPages = encountersData?.total_pages
    || (countExact ? Math.ceil(totalCount / ENCOUNTER_PAGE_SIZE) : Math.max(1, resolvedPage));
  const hasNextPage = !!encountersData?.next;
  const hasPrevPage = !!encountersData?.previous;
  const canFilter = true;
  const canJumpToPage = !rustV2Mode;
  const visibleTabs = rustV2Mode ? RUST_V2_ENCOUNTER_TABS : ENCOUNTER_TABS;
  const hasActiveFilters = canFilter && hasActiveEncounterFilters(filters, activeTab);

  useEffect(() => {
    if (encountersData?.cursor_missing && resolvedPage !== currentPage) {
      setCurrentPage(resolvedPage);
      setPersistedEncounterState({ currentPage: resolvedPage });
    }
  }, [currentPage, encountersData?.cursor_missing, resolvedPage, setPersistedEncounterState]);

  const handleFilterChange = (name, value) => {
    const nextFilters = { ...filters, [name]: value };
    setFilters(nextFilters);
    setCurrentPage(1);
    setPersistedEncounterState({ filters: nextFilters, currentPage: 1 });
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setCurrentPage(1);
    setPersistedEncounterState({ activeTab: tab, currentPage: 1 });
  };

  const resetFilters = () => {
    setActiveTab('all');
    setFilters(INITIAL_ENCOUNTER_FILTERS);
    setCurrentPage(1);
    setPersistedEncounterState({
      activeTab: 'all',
      filters: INITIAL_ENCOUNTER_FILTERS,
      currentPage: 1,
    });
  };

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      setPersistedEncounterState({ currentPage: page });
    }
  };

  return {
    activeTab,
    canFilter,
    canJumpToPage,
    countExact,
    currentPage: resolvedPage,
    encounters,
    error,
    filters,
    hasActiveFilters,
    hasNextPage,
    hasPrevPage,
    isError,
    isLoading,
    navigate,
    refetch,
    showFilters,
    totalCount,
    totalPages,
    statusOptions: rustV2Mode ? RUST_V2_ENCOUNTER_STATUS_OPTIONS : undefined,
    typeOptions: rustV2Mode ? RUST_V2_ENCOUNTER_TYPE_OPTIONS : undefined,
    visibleTabs,
    goToPage,
    handleFilterChange,
    handleTabChange,
    resetFilters,
    setShowFilters,
  };
}
