/* oxlint-disable react-doctor/prefer-useReducer -- The page owns independent search, pagination, and filter panel state; a reducer would not encode a shared transition invariant. */
import Search from 'lucide-react/dist/esm/icons/search.js';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { PatientRegistryHeader } from '@/features/patients/chronicle-list/PatientRegistryHeader';
import {
  PatientListRefreshButton,
  SearchResultsSection,
} from '@/features/patients/chronicle-list/SearchResultsSection';
import {
  CLINICAL_PROVIDER_ROLES,
  DEFAULT_REGISTRY_SCOPE,
  DEFAULT_SEARCH_ORDERING,
  REGISTRY_SCOPE_LABELS,
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
import { useWards } from '@/features/wards/hooks/useWardQueries';
import { useClinicalUnits } from '@/hooks/useOrganization';
import { useSearchPractitioners } from '@/hooks/useStaffQueries';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuth } from '@/lib/auth';
import { normalizeApiResults } from '@/lib/utils';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

/**
 * PatientChronicleListPage - table-first patient registry.
 *
 * The route owns search/filter state, bounded list queries, and explicit
 * navigation prefetching. Presentation lives in chronicle-list modules so the
 * clinical Chronicle page remains the only surface for detailed patient data.
 */
const PatientChronicleListPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOrdering, setSearchOrdering] = useState(DEFAULT_SEARCH_ORDERING);
  const [searchPage, setSearchPage] = useState(1);
  const [registryScope, setRegistryScope] = useState(DEFAULT_REGISTRY_SCOPE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState(createEmptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(createEmptyFilters);
  const pageMeta = usePageMeta({
    title: 'Patients | Hospital Management System',
    breadcrumbs: [{ label: 'Patients', path: '/patients' }],
  });

  const isClinicalProvider = CLINICAL_PROVIDER_ROLES.includes(user?.role);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const effectiveSearchQuery = debouncedSearchQuery.length >= 2 ? debouncedSearchQuery : '';
  const effectiveRegistryScope = effectiveSearchQuery ? 'all' : registryScope;
  const activeFilterCount = useMemo(() => countActiveFilters(appliedFilters), [appliedFilters]);
  const hasActiveFilters = activeFilterCount > 0;
  const hasSearchSignal = debouncedSearchQuery.length >= 2 || hasActiveFilters;

  const baseSearchParams = useMemo(
    () => buildSearchParams(debouncedSearchQuery, appliedFilters, effectiveRegistryScope),
    [debouncedSearchQuery, appliedFilters, effectiveRegistryScope]
  );

  const searchParams = useMemo(
    () => ({
      ...baseSearchParams,
      ordering: searchOrdering,
      page: searchPage,
      page_size: SEARCH_TABLE_PAGE_SIZE,
      include_total: hasSearchSignal ? 'false' : 'true',
    }),
    [baseSearchParams, hasSearchSignal, searchOrdering, searchPage]
  );

  const {
    data: searchResults,
    isLoading: isSearchLoading,
    refetch: refetchSearch,
  } = usePatientSearch(searchParams, { enabled: true });

  const { data: departmentsData, isLoading: isDepartmentsLoading } = useClinicalUnits({
    unit_type_code: 'department',
    unit_category: 'clinical',
    is_active: true,
  });

  const { data: wardsData, isLoading: isWardsLoading } = useWards({ is_active: true });

  const {
    data: practitionerResults = [],
    isLoading: isPractitionersLoading,
    setSearchTerm: setPractitionerSearch,
  } = useSearchPractitioners(false, { minLength: 2 });

  const hasSearchQuery = searchQuery.length > 0;
  const searchPatients = useMemo(() => normalizeApiResults(searchResults), [searchResults]);
  const searchMeta = useMemo(() => buildSearchResultMeta({
    searchResults,
    searchPage,
    searchPatients,
    hasSearchSignal,
    effectiveSearchQuery,
  }), [effectiveSearchQuery, hasSearchSignal, searchPage, searchPatients, searchResults]);

  const departments = useMemo(() => normalizeApiResults(departmentsData), [departmentsData]);
  const wards = useMemo(() => normalizeApiResults(wardsData), [wardsData]);

  const departmentOptions = useMemo(
    () => departments
      .map((unit) => ({ value: unit.id, label: unit.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [departments]
  );

  const wardOptions = useMemo(
    () => wards
      .map((ward) => ({ value: ward.id, label: ward.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [wards]
  );

  const departmentLabels = useMemo(
    () => new Map(departmentOptions.map((opt) => [opt.value, opt.label])),
    [departmentOptions]
  );

  const wardLabels = useMemo(
    () => new Map(wardOptions.map((opt) => [opt.value, opt.label])),
    [wardOptions]
  );

  const practitionerOptions = useMemo(
    () => (practitionerResults || []).map((practitioner) => ({
      value: practitioner.id,
      label: practitioner.specialization
        ? `${practitioner.name} · ${practitioner.specialization}`
        : practitioner.name,
    })),
    [practitionerResults]
  );

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
    setDraftFilters(createEmptyFilters());
    setAppliedFilters(createEmptyFilters());
    setSearchPage(1);
  };

  const handleClearAll = () => {
    setSearchQuery('');
    setDraftFilters(createEmptyFilters());
    setAppliedFilters(createEmptyFilters());
    setSearchPage(1);
  };

  const handleRemoveFilter = (key) => {
    const cleared = {
      ...appliedFilters,
      ...(key === 'admissionRange' ? { admissionStart: null, admissionEnd: null } : {}),
      ...(key === 'ageRange' ? { ageMin: '', ageMax: '' } : {}),
      ...(key === 'departmentId' ? { departmentId: '' } : {}),
      ...(key === 'wardId' ? { wardId: '' } : {}),
      ...(key === 'admissionStatus' ? { admissionStatus: 'all' } : {}),
      ...(key === 'admissionType' ? { admissionType: 'all' } : {}),
      ...(key === 'encounterType' ? { encounterType: 'all' } : {}),
      ...(key === 'attending' ? { attending: null } : {}),
      ...(key === 'myPatients' ? { myPatients: false } : {}),
    };
    setAppliedFilters(cleared);
    setDraftFilters(cleared);
    setSearchPage(1);
  };

  const handleOpenPatient = (patient) => {
    const patientId = getPatientId(patient);
    if (patientId) {
      prefetchPatientChronicleData(queryClient, patientId, { mode: 'navigation' });
      navigate(`/patients/${patientId}`);
    }
  };

  const handlePointerDownPatient = (patient) => {
    const patientId = getPatientId(patient);
    if (patientId) {
      prefetchPatientChronicleData(queryClient, patientId, { mode: 'navigation' });
    }
  };

  const handleSearchOrderingChange = (field) => {
    setSearchOrdering((current) => {
      const currentField = current.startsWith('-') ? current.slice(1) : current;
      if (currentField !== field) {
        return field;
      }
      return current.startsWith('-') ? field : `-${field}`;
    });
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

  const handleRegistryScopeChange = (nextScope) => {
    if (!nextScope || nextScope === registryScope) return;
    setRegistryScope(nextScope);
    setSearchPage(1);
  };

  const listHeaderLabel = effectiveSearchQuery
    ? 'Search results'
    : (REGISTRY_SCOPE_LABELS[registryScope] || REGISTRY_SCOPE_LABELS[DEFAULT_REGISTRY_SCOPE]);

  return (
    <PageShell>
      {pageMeta}
      <PatientRegistryHeader
        state={{
          userRole: user?.role,
          isClinicalProvider,
          registryScope,
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
        loading={{
          departments: isDepartmentsLoading,
          wards: isWardsLoading,
          practitioners: isPractitionersLoading,
        }}
        options={{ departmentOptions, wardOptions, practitionerOptions }}
        labels={{ departmentLabels, wardLabels }}
        handlers={{
          onAddPatient: () => navigate('/patients/create'),
          onRegistryScopeChange: handleRegistryScopeChange,
          onSearchChange: handleSearchChange,
          onClearSearch: handleClearSearch,
          onToggleFilters: () => setFiltersOpen((open) => !open),
          onDraftFiltersChange: setDraftFilters,
          onPractitionerSearch: setPractitionerSearch,
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
            <span className="text-xs">({searchMeta.totalLabel})</span>
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
