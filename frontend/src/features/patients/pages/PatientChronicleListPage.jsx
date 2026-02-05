import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js';
import List from 'lucide-react/dist/esm/icons/list.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Filter from 'lucide-react/dist/esm/icons/filter.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Star from 'lucide-react/dist/esm/icons/star.js';
import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePatientSearch,
  useRecentPatients,
  useContextPatients,
} from "@/features/patients/hooks/usePatientQueries";
import {
  useAddToMyPatients,
} from "@/features/patients/hooks/useMyPatientsQueries";
import { myPatientsKeys } from "@/features/patients/hooks/useMyPatientsQueries";
import { patientsApi } from "@/features/patients/api";
import { useAuth } from "@/lib/auth";
import { cn, normalizeApiResults } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PatientChronicleCard } from "@/components/chronicle";
import RecentPatientsSection from "@/components/patients/RecentPatientsSection";
import ContextPatientsSection from "@/components/patients/ContextPatientsSection";
import VirtualizedGrid from '@/components/ui/VirtualizedGrid';
import VirtualizedList from '@/components/ui/VirtualizedList';
import { PageShell } from "@/shared/components/page/PageShell";
import { PageHeader } from "@/shared/components/page/PageHeader";
import { usePageMeta } from "@/shared/hooks/usePageMeta";
import { useDebounce } from "@/hooks/use-debounce";
import { useWards } from "@/features/wards/hooks/useWardQueries";
import { useClinicalUnits } from "@/hooks/useOrganization";
import { useSearchPractitioners } from "@/hooks/useStaffQueries";
import { format } from "date-fns";
import {
  prefetchMyPatientsRoute,
  prefetchPatientChronicleData,
  prefetchPatientDetailRoute,
  prefetchPatientRegistryRoute,
} from "@/features/patients/prefetch";

// Clinical provider roles that can access "My Patients" feature
const CLINICAL_PROVIDER_ROLES = ['doctor', 'nurse', 'head_nurse', 'nurse_practitioner', 'inpatient_doctor', 'practitioner', 'physician', 'lab_technician', 'pharmacist'];

const ADMISSION_STATUS_OPTIONS = [
  { value: 'all', label: 'Any status' },
  { value: 'admitted', label: 'Admitted' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'discharged', label: 'Discharged' },
  { value: 'transferred', label: 'Transferred' },
  { value: 'deceased', label: 'Deceased' },
];

const ADMISSION_TYPE_OPTIONS = [
  { value: 'all', label: 'Any admission type' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'elective', label: 'Elective' },
  { value: 'maternity', label: 'Maternity' },
  { value: 'newborn', label: 'Newborn' },
];

const ENCOUNTER_TYPE_OPTIONS = [
  { value: 'all', label: 'Any encounter type' },
  { value: 'inpatient', label: 'Inpatient' },
  { value: 'outpatient', label: 'Outpatient' },
  { value: 'emergency', label: 'Emergency' },
];

const createEmptyFilters = () => ({
  admissionStart: null,
  admissionEnd: null,
  departmentId: '',
  wardId: '',
  admissionStatus: 'all',
  admissionType: 'all',
  encounterType: 'all',
  attending: null,
  ageMin: '',
  ageMax: '',
  myPatients: false,
});

const countActiveFilters = (filters) => {
  let count = 0;
  if (filters.admissionStart || filters.admissionEnd) count += 1;
  if (filters.departmentId) count += 1;
  if (filters.wardId) count += 1;
  if (filters.admissionStatus && filters.admissionStatus !== 'all') count += 1;
  if (filters.admissionType && filters.admissionType !== 'all') count += 1;
  if (filters.encounterType && filters.encounterType !== 'all') count += 1;
  if (filters.attending?.id) count += 1;
  if (filters.ageMin || filters.ageMax) count += 1;
  if (filters.myPatients) count += 1;
  return count;
};

const buildSearchParams = (query, filters) => {
  const params = {};
  if (query && query.trim().length >= 2) {
    params.query = query.trim();
  }

  if (filters.admissionStart) {
    params.admission_start = format(filters.admissionStart, 'yyyy-MM-dd');
  }
  if (filters.admissionEnd) {
    params.admission_end = format(filters.admissionEnd, 'yyyy-MM-dd');
  }
  if (filters.departmentId) {
    params.department_id = filters.departmentId;
  }
  if (filters.wardId) {
    params.ward = filters.wardId;
  }
  if (filters.admissionStatus && filters.admissionStatus !== 'all') {
    params.admission_status = filters.admissionStatus;
  }
  if (filters.admissionType && filters.admissionType !== 'all') {
    params.admission_type = filters.admissionType;
  }
  if (filters.encounterType && filters.encounterType !== 'all') {
    params.encounter_type = filters.encounterType;
  }
  if (filters.attending?.id) {
    params.attending_id = filters.attending.id;
  }
  if (filters.ageMin) {
    params.age_min = filters.ageMin;
  }
  if (filters.ageMax) {
    params.age_max = filters.ageMax;
  }
  if (filters.myPatients) {
    params.my_patients = 'true';
  }

  return params;
};

/**
 * PatientChronicleListPage - Search-first patient registry
 *
 * Features:
 * - Search-first approach (no "load all patients")
 * - Recent patients section (horizontal scroll)
 * - Context-specific patients (role-based)
 * - Route-based tab navigation to My Patients
 * - Background prefetch of My Patients data
 */
const PatientChronicleListPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState(createEmptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(createEmptyFilters);
  const pageMeta = usePageMeta({
    title: 'Patients | Hospital Management System',
    breadcrumbs: [{ label: 'Patients', path: '/patients' }],
  });

  // Check if user is a clinical provider
  const isClinicalProvider = CLINICAL_PROVIDER_ROLES.includes(user?.role);

  const prefetchPatientById = useCallback((patientId) => {
    if (!patientId) return;
    prefetchPatientChronicleData(queryClient, patientId);
  }, [queryClient]);

  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const activeFilterCount = useMemo(() => countActiveFilters(appliedFilters), [appliedFilters]);
  const hasActiveFilters = activeFilterCount > 0;
  const isSearchEnabled = debouncedSearchQuery.length >= 2 || hasActiveFilters;
  const searchParams = useMemo(
    () => buildSearchParams(debouncedSearchQuery, appliedFilters),
    [debouncedSearchQuery, appliedFilters]
  );

  const {
    data: searchResults,
    isLoading: isSearchLoading,
    refetch: refetchSearch,
  } = usePatientSearch(searchParams, { enabled: isSearchEnabled });

  // Recent patients (limited to 10)
  const {
    data: recentPatientsData,
    isLoading: isRecentLoading,
    refetch: refetchRecent,
  } = useRecentPatients(10);

  // Context patients (role-specific)
  const {
    data: contextPatientsData,
    isLoading: isContextLoading,
    refetch: refetchContext,
  } = useContextPatients();

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

  // My Patients mutations
  const addToMyPatients = useAddToMyPatients();

  // Prefetch My Patients data in background when page loads
  useEffect(() => {
    if (isClinicalProvider) {
      queryClient.prefetchQuery({
        queryKey: myPatientsKeys.list(),
        queryFn: () => patientsApi.getMyPatients?.() || Promise.resolve([]),
        staleTime: 60 * 1000,
      });
    }
  }, [isClinicalProvider, queryClient]);

  // Warm key route chunks after initial render.
  useEffect(() => {
    prefetchPatientDetailRoute();

    if (typeof window === 'undefined') return;

    const runIdlePrefetch = () => {
      prefetchMyPatientsRoute();
      prefetchPatientRegistryRoute();
    };

    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(runIdlePrefetch, { timeout: 1200 });
      return () => window.cancelIdleCallback?.(idleId);
    }

    const timeoutId = window.setTimeout(runIdlePrefetch, 300);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const isSearching = isSearchEnabled;
  const hasSearchQuery = searchQuery.length > 0;

  const searchPatients = useMemo(() => {
    if (!isSearching) return [];
    return normalizeApiResults(searchResults);
  }, [searchResults, isSearching]);

  const searchTotal = searchResults?.total ?? searchPatients.length;

  const effectiveSearchQuery = debouncedSearchQuery.length >= 2 ? debouncedSearchQuery : '';
  const searchSummary = isSearching
    ? (effectiveSearchQuery
      ? `${searchTotal} result${searchTotal === 1 ? '' : 's'} for "${effectiveSearchQuery}"`
      : `${searchTotal} filtered result${searchTotal === 1 ? '' : 's'}`)
    : '';

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

  const recentPatients = useMemo(() => {
    return normalizeApiResults(recentPatientsData);
  }, [recentPatientsData]);
  const contextPatients = useMemo(() => contextPatientsData?.patients || [], [contextPatientsData]);

  useEffect(() => {
    if (isSearching) return;

    const candidateIds = [
      ...recentPatients.slice(0, 2).map((entry) => {
        const patient = entry?.patient_profile_details || entry;
        return patient?.id || patient?.patient_profile || patient?.local_data?.id;
      }),
      ...contextPatients.slice(0, 2).map((patient) => patient?.id),
    ].filter(Boolean);

    if (candidateIds.length === 0) return;

    const prefetch = () => {
      candidateIds.forEach((patientId) => prefetchPatientById(patientId));
    };

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(prefetch, { timeout: 1200 });
      return () => window.cancelIdleCallback?.(idleId);
    }

    const timeoutId = window.setTimeout(prefetch, 300);
    return () => window.clearTimeout(timeoutId);
  }, [contextPatients, isSearching, prefetchPatientById, recentPatients]);

  // Event handlers
  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
  };

  const handleRefresh = () => {
    if (isSearching) {
      refetchSearch();
      return;
    }
    refetchRecent();
    refetchContext();
  };

  const handleApplyFilters = () => {
    setAppliedFilters(draftFilters);
    setFiltersOpen(false);
  };

  const handleClearFilters = () => {
    setDraftFilters(createEmptyFilters());
    setAppliedFilters(createEmptyFilters());
  };

  const handleClearAll = () => {
    setSearchQuery("");
    setDraftFilters(createEmptyFilters());
    setAppliedFilters(createEmptyFilters());
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
  };

  const handleAddPatient = () => {
    navigate('/patients/create');
  };

  const handleStartRound = (patient) => {
    const patientId = patient?.id || patient?.patient_profile;
    if (patientId) {
      navigate(`/patients/${patientId}?wardRound=true`);
    }
  };

  const handleStartConsultation = (patient) => {
    const patientId = patient?.id || patient?.patient_profile;
    if (patientId) {
      navigate(`/patients/${patientId}?consultation=true`);
    }
  };

  const handleAddToMyPatients = (patientId) => {
    addToMyPatients.mutate({ patientId });
  };

  // Loading state
  const isLoading = isSearching ? isSearchLoading : (isRecentLoading || isContextLoading);

  const listControls = (
    <div className="flex items-center justify-end gap-2">
      {/* View Mode Toggle */}
      <div role="group" aria-label="View mode" className="flex bg-muted rounded-lg p-0.5">
        <button
          onClick={() => setViewMode('grid')}
          aria-label="Grid view"
          aria-pressed={viewMode === 'grid'}
          className={cn(
            "p-1.5 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            viewMode === 'grid'
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <LayoutGrid className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          onClick={() => setViewMode('list')}
          aria-label="List view"
          aria-pressed={viewMode === 'list'}
          className={cn(
            "p-1.5 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            viewMode === 'list'
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <List className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Refresh */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleRefresh}
        className="shrink-0 h-9 w-9"
        aria-label="Refresh patient list"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  const headerActions = ['admin', 'receptionist'].includes(user?.role) ? (
    <Button onClick={handleAddPatient} size="sm" className="font-mono text-xs">
      <Plus className="h-4 w-4 mr-2" />
      Register Patient
    </Button>
  ) : null;

  const listHeaderLabel = isSearching
    ? (effectiveSearchQuery ? 'Search results' : 'Filtered results')
    : 'Recent';

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="Patient Registry"
        description="Search for patients or browse your recent and assigned patients"
        size="md"
        actions={headerActions}
        contentClassName="sm:items-start"
      >
        {/* Tab Navigation - Using NavLinks for routes */}
        {isClinicalProvider && (
          <div className="flex items-center gap-1 mt-4 bg-muted rounded-lg p-1 w-fit">
            <NavLink
              to="/patients"
              end
              onMouseEnter={prefetchPatientRegistryRoute}
              onFocus={prefetchPatientRegistryRoute}
              className={({ isActive }) => cn(
                "px-4 py-2 rounded-md text-sm font-mono transition-colors flex items-center gap-2",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Users className="h-4 w-4" />
              All Patients
            </NavLink>
            <NavLink
              to="/patients/my-patients"
              onMouseEnter={prefetchMyPatientsRoute}
              onFocus={prefetchMyPatientsRoute}
              className={({ isActive }) => cn(
                "px-4 py-2 rounded-md text-sm font-mono transition-colors flex items-center gap-2",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Star className="h-4 w-4" />
              My Patients
            </NavLink>
          </div>
        )}

        {/* Search Bar */}
        <div className="flex flex-col gap-3 mt-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative w-full sm:max-w-3xl lg:max-w-4xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Label htmlFor="patient-search" className="sr-only">Search by name, MRN, or NHIS ID</Label>
              <Input
                id="patient-search"
                placeholder="Search by name, MRN, or NHIS ID (min 2 characters)..."
                value={searchQuery}
                onChange={handleSearchChange}
                className="pl-10 pr-10 font-mono text-sm bg-background"
              />
              {hasSearchQuery && (
                <button
                  onClick={handleClearSearch}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFiltersOpen((open) => !open)}
                className="font-mono text-xs"
              >
                <Filter className="h-4 w-4 mr-2" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </div>
          </div>

          {filtersOpen && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-xs font-mono text-muted-foreground">Admission Date</Label>
                  <DateRangePicker
                    from={draftFilters.admissionStart}
                    to={draftFilters.admissionEnd}
                    onChange={({ from, to }) => setDraftFilters((prev) => ({
                      ...prev,
                      admissionStart: from,
                      admissionEnd: to,
                    }))}
                    pickerClassName="w-[140px] font-mono text-xs"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-mono text-muted-foreground">Admission Status</Label>
                  <Select
                    value={draftFilters.admissionStatus}
                    onValueChange={(value) => setDraftFilters((prev) => ({ ...prev, admissionStatus: value }))}
                  >
                    <SelectTrigger className="w-full font-mono text-xs">
                      <SelectValue placeholder="Any status" />
                    </SelectTrigger>
                    <SelectContent>
                      {ADMISSION_STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value} className="font-mono text-xs">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-mono text-muted-foreground">Admission Type</Label>
                  <Select
                    value={draftFilters.admissionType}
                    onValueChange={(value) => setDraftFilters((prev) => ({ ...prev, admissionType: value }))}
                  >
                    <SelectTrigger className="w-full font-mono text-xs">
                      <SelectValue placeholder="Any type" />
                    </SelectTrigger>
                    <SelectContent>
                      {ADMISSION_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value} className="font-mono text-xs">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-mono text-muted-foreground">Department</Label>
                  <Select
                    value={draftFilters.departmentId || 'all'}
                    onValueChange={(value) => setDraftFilters((prev) => ({
                      ...prev,
                      departmentId: value === 'all' ? '' : value,
                    }))}
                  >
                    <SelectTrigger className="w-full font-mono text-xs">
                      <SelectValue placeholder={isDepartmentsLoading ? "Loading..." : "Any department"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="font-mono text-xs">Any department</SelectItem>
                      {departmentOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value} className="font-mono text-xs">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-mono text-muted-foreground">Ward</Label>
                  <Select
                    value={draftFilters.wardId || 'all'}
                    onValueChange={(value) => setDraftFilters((prev) => ({
                      ...prev,
                      wardId: value === 'all' ? '' : value,
                    }))}
                  >
                    <SelectTrigger className="w-full font-mono text-xs">
                      <SelectValue placeholder={isWardsLoading ? "Loading..." : "Any ward"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="font-mono text-xs">Any ward</SelectItem>
                      {wardOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value} className="font-mono text-xs">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-mono text-muted-foreground">Encounter Type</Label>
                  <Select
                    value={draftFilters.encounterType}
                    onValueChange={(value) => setDraftFilters((prev) => ({ ...prev, encounterType: value }))}
                  >
                    <SelectTrigger className="w-full font-mono text-xs">
                      <SelectValue placeholder="Any encounter" />
                    </SelectTrigger>
                    <SelectContent>
                      {ENCOUNTER_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value} className="font-mono text-xs">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-mono text-muted-foreground">Attending Clinician</Label>
                  <Combobox
                    options={practitionerOptions}
                    value={draftFilters.attending?.id || null}
                    onChange={(value) => {
                      const selected = practitionerOptions.find((option) => option.value === value);
                      setDraftFilters((prev) => ({
                        ...prev,
                        attending: selected ? { id: selected.value, name: selected.label } : null,
                      }));
                      setPractitionerSearch("");
                    }}
                    onInputChange={(value) => setPractitionerSearch(value)}
                    displayValue={() => draftFilters.attending?.name || "Select clinician"}
                    searchPlaceholder="Search clinicians..."
                    emptyMessage="No clinicians found."
                    isLoading={isPractitionersLoading}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-mono text-muted-foreground">Age Range</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      placeholder="Min"
                      value={draftFilters.ageMin}
                      onChange={(e) => setDraftFilters((prev) => ({
                        ...prev,
                        ageMin: e.target.value.replace(/[^\d]/g, ''),
                      }))}
                      className="w-20 font-mono text-xs"
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input
                      type="number"
                      min="0"
                      placeholder="Max"
                      value={draftFilters.ageMax}
                      onChange={(e) => setDraftFilters((prev) => ({
                        ...prev,
                        ageMax: e.target.value.replace(/[^\d]/g, ''),
                      }))}
                      className="w-20 font-mono text-xs"
                    />
                  </div>
                </div>
                {isClinicalProvider && (
                  <div className="space-y-2">
                    <Label className="text-xs font-mono text-muted-foreground">My Patients</Label>
                    <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                      <span className="text-xs text-muted-foreground">Only patients in my list</span>
                      <Switch
                        checked={draftFilters.myPatients}
                        onCheckedChange={(checked) => setDraftFilters((prev) => ({
                          ...prev,
                          myPatients: checked,
                        }))}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  {activeFilterCount > 0 ? `${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}` : 'No active filters'}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearFilters}
                    className="font-mono text-xs"
                  >
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApplyFilters}
                    className="font-mono text-xs"
                  >
                    Apply Filters
                  </Button>
                </div>
              </div>
            </div>
          )}

          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2">
              {(appliedFilters.admissionStart || appliedFilters.admissionEnd) && (
                <FilterChip
                  label={appliedFilters.admissionStart && appliedFilters.admissionEnd
                    ? `Admission ${format(appliedFilters.admissionStart, 'MMM d')}–${format(appliedFilters.admissionEnd, 'MMM d')}`
                    : appliedFilters.admissionStart
                      ? `Admission after ${format(appliedFilters.admissionStart, 'MMM d')}`
                      : `Admission before ${format(appliedFilters.admissionEnd, 'MMM d')}`}
                  onRemove={() => handleRemoveFilter('admissionRange')}
                />
              )}
              {appliedFilters.departmentId && (
                <FilterChip
                  label={`Department: ${departmentLabels.get(appliedFilters.departmentId) || 'Selected'}`}
                  onRemove={() => handleRemoveFilter('departmentId')}
                />
              )}
              {appliedFilters.wardId && (
                <FilterChip
                  label={`Ward: ${wardLabels.get(appliedFilters.wardId) || 'Selected'}`}
                  onRemove={() => handleRemoveFilter('wardId')}
                />
              )}
              {appliedFilters.admissionStatus !== 'all' && (
                <FilterChip
                  label={`Status: ${ADMISSION_STATUS_OPTIONS.find((opt) => opt.value === appliedFilters.admissionStatus)?.label || appliedFilters.admissionStatus}`}
                  onRemove={() => handleRemoveFilter('admissionStatus')}
                />
              )}
              {appliedFilters.admissionType !== 'all' && (
                <FilterChip
                  label={`Admission Type: ${ADMISSION_TYPE_OPTIONS.find((opt) => opt.value === appliedFilters.admissionType)?.label || appliedFilters.admissionType}`}
                  onRemove={() => handleRemoveFilter('admissionType')}
                />
              )}
              {appliedFilters.encounterType !== 'all' && (
                <FilterChip
                  label={`Encounter: ${ENCOUNTER_TYPE_OPTIONS.find((opt) => opt.value === appliedFilters.encounterType)?.label || appliedFilters.encounterType}`}
                  onRemove={() => handleRemoveFilter('encounterType')}
                />
              )}
              {appliedFilters.attending?.id && (
                <FilterChip
                  label={`Attending: ${appliedFilters.attending.name}`}
                  onRemove={() => handleRemoveFilter('attending')}
                />
              )}
              {(appliedFilters.ageMin || appliedFilters.ageMax) && (
                <FilterChip
                  label={`Age ${appliedFilters.ageMin || '0'}–${appliedFilters.ageMax || '∞'}`}
                  onRemove={() => handleRemoveFilter('ageRange')}
                />
              )}
              {appliedFilters.myPatients && (
                <FilterChip
                  label="My Patients"
                  onRemove={() => handleRemoveFilter('myPatients')}
                />
              )}
              {(hasSearchQuery || hasActiveFilters) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  className="font-mono text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear all
                </Button>
              )}
            </div>
          )}

          {isSearching && (
            <div className="text-xs text-muted-foreground">
              <span>{searchSummary}</span>
            </div>
          )}
        </div>
      </PageHeader>

      {/* Main Content */}
      <main className="p-4 sm:p-6 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            {isSearching ? (
              <Search className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Clock className="h-4 w-4" aria-hidden="true" />
            )}
            <h2 className="font-heading text-sm font-medium text-foreground">
              {listHeaderLabel}
            </h2>
            {isSearching ? (
              <span className="text-xs">({searchTotal})</span>
            ) : (
              !isRecentLoading && <span className="text-xs">({recentPatients.length})</span>
            )}
          </div>
          {listControls}
        </div>

        {isSearching ? (
          // Show search results
          <SearchResultsSection
            patients={searchPatients}
            isLoading={isSearchLoading}
            searchQuery={effectiveSearchQuery}
            hasActiveFilters={hasActiveFilters}
            viewMode={viewMode}
            onStartRound={handleStartRound}
            onStartConsultation={handleStartConsultation}
            onAddToMyPatients={handleAddToMyPatients}
            showMyPatientsActions={isClinicalProvider}
            onPrefetchPatient={prefetchPatientById}
          />
        ) : (
          // Show recent + context patients
          <>
            <RecentPatientsSection
              patients={recentPatients}
              isLoading={isRecentLoading}
              showHeader={false}
              onPrefetchPatient={prefetchPatientById}
            />

            <ContextPatientsSection
              data={contextPatientsData}
              isLoading={isContextLoading}
              onStartRound={handleStartRound}
              onStartConsultation={handleStartConsultation}
              onAddToMyPatients={handleAddToMyPatients}
              showMyPatientsActions={isClinicalProvider}
              onPrefetchPatient={prefetchPatientById}
            />

          </>
        )}
      </main>
    </PageShell>
  );
};

const FilterChip = ({ label, onRemove }) => (
  <Badge variant="secondary" className="gap-1 pr-1 text-[10px] font-mono">
    <span className="truncate max-w-[220px]">{label}</span>
    <button
      type="button"
      onClick={onRemove}
      className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label={`Remove ${label}`}
    >
      <X className="h-3 w-3" aria-hidden="true" />
    </button>
  </Badge>
);

/**
 * SearchResultsSection - Display search results
 */
const SearchResultsSection = ({
  patients,
  isLoading,
  searchQuery,
  hasActiveFilters,
  viewMode,
  onStartRound,
  onStartConsultation,
  onAddToMyPatients,
  showMyPatientsActions,
  onPrefetchPatient,
}) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-card/50 border border-border rounded-2xl p-6 animate-pulse">
            <div className="h-6 bg-muted rounded w-2/3 mb-3" />
            <div className="h-4 bg-muted rounded w-1/2 mb-4" />
            <div className="h-20 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (patients.length === 0) {
    const emptyDescription = searchQuery
      ? `No patients match "${searchQuery}". Try a different search term.`
      : hasActiveFilters
        ? 'No patients match these filters. Try adjusting your criteria.'
        : 'No patients found.';

    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="font-display text-xl text-foreground mb-2">
          No patients found
        </h3>
        <p className="text-muted-foreground text-sm max-w-md">
          {emptyDescription}
        </p>
      </div>
    );
  }

  // Deduplicate patients by ID
  const uniquePatients = patients.reduce((acc, patientData, index) => {
    const patient = patientData?.local_data || patientData;
    const id = patient?.id;
    if (id && !acc.seen.has(id)) {
      acc.seen.add(id);
      acc.list.push({ patient, originalIndex: index });
    } else if (!id) {
      // Keep patients without ID (fallback)
      acc.list.push({ patient, originalIndex: index });
    }
    return acc;
  }, { seen: new Set(), list: [] }).list;

  if (viewMode === 'grid') {
    return (
      <VirtualizedGrid
        items={uniquePatients}
        minItemWidth={320}
        rowHeight={320}
        gap={24}
        getItemKey={(item, index) => `search-${item.patient?.id || item.originalIndex}-${index}`}
        renderItem={({ patient, originalIndex }, index) => (
          <PatientChronicleCard
            patient={patient}
            index={index}
            onStartRound={onStartRound}
            onStartConsultation={onStartConsultation}
            onAddToMyPatients={onAddToMyPatients}
            showMyPatientsActions={showMyPatientsActions}
            onPrefetchPatient={onPrefetchPatient}
          />
        )}
      />
    );
  }

  return (
    <VirtualizedList
      items={uniquePatients}
      estimateSize={180}
      gap={16}
      getItemKey={(item, index) => `search-${item.patient?.id || item.originalIndex}-${index}`}
      renderItem={({ patient }, index) => (
        <PatientChronicleCard
          patient={patient}
          index={index}
          onStartRound={onStartRound}
          onStartConsultation={onStartConsultation}
          onAddToMyPatients={onAddToMyPatients}
          showMyPatientsActions={showMyPatientsActions}
          onPrefetchPatient={onPrefetchPatient}
          className="max-w-none"
        />
      )}
    />
  );
};

export default PatientChronicleListPage;
