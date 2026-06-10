/* oxlint-disable react-doctor/prefer-useReducer -- The page owns independent search, pagination, and filter panel state; a reducer would not encode a shared transition invariant. */
import Search from 'lucide-react/dist/esm/icons/search.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { PatientRegistryHeader } from '@/features/patients/chronicle-list/PatientRegistryHeader';
import {
  PatientListRefreshButton,
  SearchResultsSection,
} from '@/features/patients/chronicle-list/SearchResultsSection';
import {
  DIRECTORY_SECTION_LABELS,
  DEFAULT_SEARCH_ORDERING,
  SEARCH_TABLE_PAGE_SIZE,
} from '@/features/patients/chronicle-list/registryConstants';
import {
  buildSearchParams,
  buildSearchResultMeta,
  countActiveFilters,
  createEmptyFilters,
  getPatientId,
} from '@/features/patients/chronicle-list/registryHelpers';
import { prefetchPatientChronicleData } from '@/features/patients/prefetch';
import { usePatientSearch } from '@/features/patients/hooks/usePatientQueries';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuth } from '@/lib/auth';
import { createReturnToLocation } from '@/shared/lib/returnTo';
import { normalizeApiResults } from '@/lib/utils';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

const REGISTRY_HISTORY_STATE_KEY = 'patientRegistryState';
const CLINICAL_DIRECTORY_ROLES = new Set([
  'admin',
  'doctor',
  'nurse',
  'head_nurse',
  'nurse_practitioner',
  'inpatient_doctor',
  'practitioner',
  'physician',
]);

function serializeFilterDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseFilterDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function serializeFilters(filters) {
  return {
    recordStatus: filters.recordStatus || 'all',
    vitalStatus: filters.vitalStatus || 'all',
    admissionStart: serializeFilterDate(filters.admissionStart),
    admissionEnd: serializeFilterDate(filters.admissionEnd),
    wardId: filters.wardId || '',
    wardName: filters.wardName || '',
    admissionStatus: filters.admissionStatus || 'all',
    attending: filters.attending?.id
      ? { id: filters.attending.id, name: filters.attending.name || '' }
      : null,
    ageMin: filters.ageMin || '',
    ageMax: filters.ageMax || '',
  };
}

function hydrateFilters(value) {
  const emptyFilters = createEmptyFilters();
  if (!value || typeof value !== 'object') {
    return emptyFilters;
  }
  return {
    ...emptyFilters,
    recordStatus: typeof value.recordStatus === 'string' ? value.recordStatus : emptyFilters.recordStatus,
    vitalStatus: typeof value.vitalStatus === 'string' ? value.vitalStatus : emptyFilters.vitalStatus,
    admissionStart: parseFilterDate(value.admissionStart),
    admissionEnd: parseFilterDate(value.admissionEnd),
    wardId: typeof value.wardId === 'string' ? value.wardId : '',
    wardName: typeof value.wardName === 'string' ? value.wardName : '',
    admissionStatus: typeof value.admissionStatus === 'string' ? value.admissionStatus : 'all',
    attending: value.attending?.id
      ? { id: value.attending.id, name: value.attending.name || '' }
      : null,
    ageMin: value.ageMin ? String(value.ageMin).replace(/[^\d]/g, '') : '',
    ageMax: value.ageMax ? String(value.ageMax).replace(/[^\d]/g, '') : '',
  };
}

function hydrateRegistryState(locationState) {
  const persisted = locationState?.[REGISTRY_HISTORY_STATE_KEY];
  if (!persisted || typeof persisted !== 'object') {
    return {
      searchQuery: '',
      searchOrdering: DEFAULT_SEARCH_ORDERING,
      searchPage: 1,
      draftFilters: createEmptyFilters(),
      appliedFilters: createEmptyFilters(),
    };
  }
  const searchPage = Number.parseInt(String(persisted.searchPage || 1), 10);
  return {
    searchQuery: typeof persisted.searchQuery === 'string' ? persisted.searchQuery : '',
    searchOrdering: typeof persisted.searchOrdering === 'string'
      ? persisted.searchOrdering
      : DEFAULT_SEARCH_ORDERING,
    searchPage: Number.isFinite(searchPage) && searchPage > 0 ? searchPage : 1,
    draftFilters: hydrateFilters(persisted.draftFilters),
    appliedFilters: hydrateFilters(persisted.appliedFilters),
  };
}

/**
 * PatientChronicleListPage - table-first patient directory.
 *
 * The route owns directory search/filter state, bounded list queries, and explicit
 * navigation prefetching. Presentation lives in chronicle-list modules so the
 * clinical Chronicle page remains the only surface for detailed patient data.
 */
const PatientChronicleListPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    pathname,
    search: routeSearch,
    state: routeState,
  } = location;
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canOpenChronicle = CLINICAL_DIRECTORY_ROLES.has(user?.role);
  const [initialRegistryState] = useState(() => hydrateRegistryState(routeState));
  const [searchQuery, setSearchQuery] = useState(initialRegistryState.searchQuery);
  const [searchOrdering, setSearchOrdering] = useState(initialRegistryState.searchOrdering);
  const [searchPage, setSearchPage] = useState(initialRegistryState.searchPage);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState(initialRegistryState.draftFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialRegistryState.appliedFilters);
  const locationStateRef = useRef(routeState || {});
  const lastPersistedRegistryStateRef = useRef('');
  const pageMeta = usePageMeta({
    title: 'Patient Directory | Hospital Management System',
    breadcrumbs: [{ label: 'Patient Directory', path: '/patients' }],
  });

  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const effectiveSearchQuery = debouncedSearchQuery.length >= 2 ? debouncedSearchQuery : '';
  const activeFilterCount = useMemo(() => countActiveFilters(appliedFilters), [appliedFilters]);
  const hasActiveFilters = activeFilterCount > 0;
  const hasSearchSignal = debouncedSearchQuery.length >= 2 || hasActiveFilters;
  const registryHistoryState = useMemo(() => ({
    searchQuery,
    searchOrdering,
    searchPage,
    draftFilters: serializeFilters(draftFilters),
    appliedFilters: serializeFilters(appliedFilters),
  }), [appliedFilters, draftFilters, searchOrdering, searchPage, searchQuery]);

  useEffect(() => {
    locationStateRef.current = routeState || {};
  });

  useEffect(() => {
    const serialized = JSON.stringify(registryHistoryState);
    if (lastPersistedRegistryStateRef.current === serialized) {
      return;
    }
    lastPersistedRegistryStateRef.current = serialized;
    navigate(`${pathname}${routeSearch}`, {
      replace: true,
      state: {
        ...locationStateRef.current,
        [REGISTRY_HISTORY_STATE_KEY]: registryHistoryState,
      },
      preventScrollReset: true,
    });
  }, [navigate, pathname, registryHistoryState, routeSearch]);

  const baseSearchParams = useMemo(
    () => buildSearchParams(debouncedSearchQuery, appliedFilters),
    [debouncedSearchQuery, appliedFilters]
  );

  const searchParams = useMemo(
    () => ({
      ...baseSearchParams,
      ordering: searchOrdering,
      page: searchPage,
      page_size: SEARCH_TABLE_PAGE_SIZE,
    }),
    [baseSearchParams, searchOrdering, searchPage]
  );

  const {
    data: searchResults,
    isLoading: isSearchLoading,
    refetch: refetchSearch,
  } = usePatientSearch(searchParams, { enabled: true });

  const hasSearchQuery = searchQuery.length > 0;
  const searchPatients = useMemo(() => normalizeApiResults(searchResults), [searchResults]);
  const searchMeta = useMemo(() => buildSearchResultMeta({
    searchResults,
    searchPage,
    searchPatients,
    hasSearchSignal,
    effectiveSearchQuery,
  }), [effectiveSearchQuery, hasSearchSignal, searchPage, searchPatients, searchResults]);

  const handleSearchChange = (event) => {
    setSearchQuery(event.target.value);
    setSearchPage(1);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchPage(1);
  };

  const handleApplyFilters = () => {
    setAppliedFilters(draftFilters);
    setSearchPage(1);
    setFiltersOpen(false);
  };

  const handleClearFilters = () => {
    const emptyFilters = createEmptyFilters();
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setSearchPage(1);
  };

  const handleClearAll = () => {
    const emptyFilters = createEmptyFilters();
    setDraftFilters(emptyFilters);
    setSearchQuery('');
    setAppliedFilters(emptyFilters);
    setSearchPage(1);
  };

  const handleRemoveFilter = (key) => {
    const cleared = {
      ...appliedFilters,
      ...(key === 'recordStatus' ? { recordStatus: 'all' } : {}),
      ...(key === 'vitalStatus' ? { vitalStatus: 'all' } : {}),
      ...(key === 'admissionRange' ? { admissionStart: null, admissionEnd: null } : {}),
      ...(key === 'ageRange' ? { ageMin: '', ageMax: '' } : {}),
      ...(key === 'wardId' ? { wardId: '', wardName: '' } : {}),
      ...(key === 'admissionStatus' ? { admissionStatus: 'all' } : {}),
      ...(key === 'attending' ? { attending: null } : {}),
    };
    setDraftFilters(cleared);
    setAppliedFilters(cleared);
    setSearchPage(1);
  };

  const handleOpenPatient = (patient) => {
    const patientId = getPatientId(patient);
    if (patientId) {
      if (canOpenChronicle) {
        prefetchPatientChronicleData(queryClient, patientId, { mode: 'navigation' });
      }
      navigate(`/patients/${patientId}/${canOpenChronicle ? 'chronicle' : 'profile'}`, {
        state: {
          returnTo: createReturnToLocation({
            ...location,
            state: locationStateRef.current,
          }),
        },
      });
    }
  };

  const handlePointerDownPatient = (patient) => {
    const patientId = getPatientId(patient);
    if (patientId && canOpenChronicle) {
      prefetchPatientChronicleData(queryClient, patientId, { mode: 'navigation' });
    }
  };

  const handleSearchOrderingChange = (field) => {
    const currentField = searchOrdering.startsWith('-') ? searchOrdering.slice(1) : searchOrdering;
    const nextOrdering = currentField !== field
      ? field
      : (searchOrdering.startsWith('-') ? field : `-${field}`);
    setSearchOrdering(nextOrdering);
    setSearchPage(1);
  };

  const handleSearchPageChange = (nextPage) => {
    if (!Number.isFinite(nextPage)) return;
    const maxPage = searchMeta.pagination.totalResultsExact
      ? searchMeta.pagination.totalPages
      : (searchMeta.pagination.hasNextPage ? searchMeta.currentPage + 1 : searchMeta.currentPage);
    const boundedPage = Math.min(Math.max(nextPage, 1), Math.max(maxPage, 1));
    setSearchPage(boundedPage);
  };

  const handleToggleFilters = () => {
    setFiltersOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setDraftFilters(appliedFilters);
      }
      return nextOpen;
    });
  };

  const listHeaderLabel = effectiveSearchQuery
    ? DIRECTORY_SECTION_LABELS.search
    : (hasActiveFilters ? DIRECTORY_SECTION_LABELS.filtered : DIRECTORY_SECTION_LABELS.recent);

  return (
    <PageShell>
      {pageMeta}
      <PatientRegistryHeader
        state={{
          userRole: user?.role,
          searchQuery,
          hasSearchQuery,
          filtersOpen,
          activeFilterCount,
          draftFilters,
          appliedFilters,
          hasActiveFilters,
          hasSearchSignal,
          searchSummary: searchMeta.summary,
        }}
        handlers={{
          onAddPatient: () => navigate('/patients/create'),
          onSearchChange: handleSearchChange,
          onClearSearch: handleClearSearch,
          onToggleFilters: handleToggleFilters,
          onDraftFiltersChange: setDraftFilters,
          onClearFilters: handleClearFilters,
          onApplyFilters: handleApplyFilters,
          onRemoveFilter: handleRemoveFilter,
          onClearAll: handleClearAll,
        }}
      />

      <main
        data-perf-ready={isSearchLoading ? undefined : 'patient-registry'}
        className="p-4 sm:p-6 space-y-8"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Search className="size-4" aria-hidden="true" />
            <h2 className="font-heading text-sm font-medium text-foreground">
              {listHeaderLabel}
            </h2>
            {searchMeta.totalLabel ? (
              <span className="text-xs">({searchMeta.totalLabel})</span>
            ) : null}
          </div>
          <PatientListRefreshButton onRefresh={refetchSearch} />
        </div>
        <SearchResultsSection
          patients={searchPatients}
          isLoading={isSearchLoading}
          searchQuery={effectiveSearchQuery}
          hasActiveFilters={hasActiveFilters}
          ordering={searchOrdering}
          onOrderingChange={handleSearchOrderingChange}
          pagination={searchMeta.pagination}
          onPageChange={handleSearchPageChange}
          onOpenPatient={handleOpenPatient}
          onPointerDownPatient={handlePointerDownPatient}
        />
      </main>
    </PageShell>
  );
};

export default PatientChronicleListPage;
