import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useEncounters } from '@/features/encounters/hooks/useEncounterQueries';
import {
  ENCOUNTER_PAGE_SIZE,
  INITIAL_ENCOUNTER_FILTERS,
} from './encounterListConstants';
import {
  buildEncounterQueryParams,
  hasActiveEncounterFilters,
} from './encounterListUtils';

export function useEncounterListController() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState(INITIAL_ENCOUNTER_FILTERS);

  const queryParams = useMemo(
    () => buildEncounterQueryParams({ activeTab, currentPage, filters }),
    [activeTab, currentPage, filters]
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
  const totalPages = Math.ceil(totalCount / ENCOUNTER_PAGE_SIZE);
  const hasNextPage = !!encountersData?.next;
  const hasPrevPage = !!encountersData?.previous;
  const hasActiveFilters = hasActiveEncounterFilters(filters, activeTab);

  const handleFilterChange = (name, value) => {
    setFilters(previousFilters => ({ ...previousFilters, [name]: value }));
    setCurrentPage(1);
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setCurrentPage(1);
  };

  const resetFilters = () => {
    setFilters(INITIAL_ENCOUNTER_FILTERS);
    setCurrentPage(1);
  };

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  return {
    activeTab,
    currentPage,
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
    goToPage,
    handleFilterChange,
    handleTabChange,
    resetFilters,
    setShowFilters,
  };
}
