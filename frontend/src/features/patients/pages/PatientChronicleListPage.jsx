import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Filter from 'lucide-react/dist/esm/icons/filter.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Star from 'lucide-react/dist/esm/icons/star.js';
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.js';
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.js';
import ArrowUpDown from 'lucide-react/dist/esm/icons/arrow-up-down.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import { useState, useMemo, useEffect } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePatientSearch,
} from "@/features/patients/hooks/usePatientQueries";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

const DEFAULT_SEARCH_ORDERING = '-created_at';
const SEARCH_TABLE_PAGE_SIZE = 25;
const DEFAULT_REGISTRY_SCOPE = 'active';

const REGISTRY_SCOPE_TABS = [
  { value: 'active', label: 'Active' },
  { value: 'discharged', label: 'Discharged' },
  { value: 'deceased', label: 'Deceased' },
  { value: 'all', label: 'All Registered' },
];

const REGISTRY_SCOPE_LABELS = {
  active: 'Active patients',
  discharged: 'Discharged patients',
  deceased: 'Deceased patients',
  all: 'All registered patients',
};

const TABLE_COLUMNS = [
  { key: 'created_at', label: 'Registered' },
  { key: 'medical_record_number', label: 'MRN' },
  { key: 'name', label: 'Name' },
  { key: 'date_of_birth', label: 'DOB / Age' },
  { key: 'gender', label: 'Sex' },
  { key: 'patient_location', label: 'Patient Location' },
  { key: 'registry_status', label: 'Status' },
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

const buildSearchParams = (query, filters, registryScope) => {
  const params = {};
  if (query && query.trim().length >= 2) {
    params.query = query.trim();
  }
  params.registry_scope = registryScope;

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

const getPatientId = (patient) => {
  return patient?.id || patient?.patient_profile || patient?.local_data?.id || null;
};

const getPatientAge = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
};

const formatGender = (gender) => {
  if (!gender) return '—';
  const code = String(gender).toLowerCase();
  if (code === 'm' || code === 'male') return 'Male';
  if (code === 'f' || code === 'female') return 'Female';
  if (code === 'o' || code === 'other') return 'Other';
  return String(gender);
};

const formatDateLabel = (value, template = 'MMM d, yyyy') => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, template);
};

const formatAdmissionStatus = (status) => {
  if (!status) return '—';
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const getAdmissionLocationLabel = (patient) => {
  const admission = patient?.active_admission || patient?.active_context?.admission || patient?.admission || null;
  const wardName = patient?.ward_name || patient?.current_ward || admission?.ward_name || admission?.ward || '';
  const bedCode = patient?.bed_code || patient?.bed_number || patient?.current_bed || admission?.bed_code || admission?.bed_number || '';

  if (wardName && bedCode) {
    return `${wardName} / Bed ${bedCode}`;
  }
  if (wardName) {
    return wardName;
  }
  if (bedCode) {
    return `Bed ${bedCode}`;
  }
  return '';
};

const getPatientLocationDisplay = (patient) => {
  const activeClinicNames = Array.isArray(patient?.active_clinic_names)
    ? patient.active_clinic_names.filter(Boolean)
    : [];

  if (activeClinicNames.length > 1) {
    return {
      label: `${activeClinicNames[0]} +${activeClinicNames.length - 1}`,
      tooltip: activeClinicNames.join(', '),
    };
  }

  if (activeClinicNames.length === 1) {
    return {
      label: activeClinicNames[0],
      tooltip: null,
    };
  }

  return {
    label: patient?.patient_location || getAdmissionLocationLabel(patient) || '—',
    tooltip: null,
  };
};

const getKnownResultCount = ({ currentPage, pageSize, visibleCount }) => {
  if (visibleCount <= 0) {
    return 0;
  }
  return ((currentPage - 1) * pageSize) + visibleCount;
};

const formatResultCountLabel = ({ count, isExact, hasNextPage }) => {
  if (isExact || !hasNextPage) {
    return String(count);
  }
  return `${count}+`;
};

const formatFooterResultLabel = ({ currentPage, pageSize, visibleCount, totalResults, isExact, hasNextPage }) => {
  if (isExact) {
    return `${totalResults} result${totalResults === 1 ? '' : 's'}`;
  }
  if (visibleCount <= 0) {
    return '0 results';
  }

  const start = ((currentPage - 1) * pageSize) + 1;
  const end = start + visibleCount - 1;
  const range = start === end ? String(start) : `${start}-${end}`;
  return `Showing ${range}${hasNextPage ? '+' : ''} result${end === 1 && !hasNextPage ? '' : 's'}`;
};

const formatFooterPageLabel = ({ currentPage, totalPages, isExact, hasNextPage }) => {
  if (isExact || !hasNextPage) {
    return `Page ${currentPage} of ${totalPages}`;
  }
  return `Page ${currentPage}`;
};

/**
 * PatientChronicleListPage - Table-first patient registry
 *
 * Features:
 * - Always-on sortable table with newest registrations first
 * - Search and filters for narrowing results
 * - Route-based tab navigation to My Patients
 * - Background route/data prefetching for fast navigation
 */
const PatientChronicleListPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
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

  // Check if user is a clinical provider
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

  useEffect(() => {
    setSearchPage(1);
  }, [debouncedSearchQuery, appliedFilters, registryScope]);

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

  const searchCurrentPage = searchResults?.page ?? searchPage;
  const searchPageSize = searchResults?.page_size ?? SEARCH_TABLE_PAGE_SIZE;
  const searchCountExact = searchResults?.count_exact !== false;
  const searchHasNext = Boolean(searchResults?.next);
  const searchHasPrevious = Boolean(searchResults?.previous) || searchCurrentPage > 1;
  const searchKnownResultCount = getKnownResultCount({
    currentPage: searchCurrentPage,
    pageSize: searchPageSize,
    visibleCount: searchPatients.length,
  });
  const searchTotal = searchCountExact
    ? (searchResults?.total ?? searchResults?.count ?? searchPatients.length)
    : searchKnownResultCount;
  const searchTotalLabel = formatResultCountLabel({
    count: searchTotal,
    isExact: searchCountExact,
    hasNextPage: searchHasNext,
  });
  const searchTotalPages = searchCountExact
    ? (searchPageSize > 0
      ? Math.max(1, Math.ceil(searchTotal / searchPageSize))
      : 1)
    : searchCurrentPage;
  const searchPagination = useMemo(() => ({
    currentPage: searchCurrentPage,
    pageSize: searchPageSize,
    totalPages: searchTotalPages,
    totalResults: searchTotal,
    totalResultsExact: searchCountExact,
    hasNextPage: searchHasNext,
    hasPreviousPage: searchHasPrevious,
  }), [
    searchCountExact,
    searchCurrentPage,
    searchHasNext,
    searchHasPrevious,
    searchPageSize,
    searchTotal,
    searchTotalPages,
  ]);

  const searchSummary = hasSearchSignal
    ? (effectiveSearchQuery
      ? (searchCountExact
        ? `${searchTotal} result${searchTotal === 1 ? '' : 's'} for "${effectiveSearchQuery}"`
        : `Showing ${searchPatients.length} result${searchPatients.length === 1 ? '' : 's'} for "${effectiveSearchQuery}"`)
      : (searchCountExact
        ? `${searchTotal} filtered result${searchTotal === 1 ? '' : 's'}`
        : `Showing ${searchPatients.length} filtered result${searchPatients.length === 1 ? '' : 's'}`))
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

  // Event handlers
  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    setSearchPage(1);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setSearchPage(1);
  };

  const handleRefresh = () => {
    refetchSearch();
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
    setSearchQuery("");
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

  const handleAddPatient = () => {
    navigate('/patients/create');
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
    const maxPage = searchCountExact
      ? searchTotalPages
      : (searchHasNext ? searchCurrentPage + 1 : searchCurrentPage);
    const boundedPage = Math.min(Math.max(nextPage, 1), Math.max(maxPage, 1));
    setSearchPage(boundedPage);
  };

  const handleRegistryScopeChange = (nextScope) => {
    if (!nextScope || nextScope === registryScope) return;
    setRegistryScope(nextScope);
    setSearchPage(1);
  };

  const listControls = (
    <div className="flex items-center justify-end gap-2">
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

  const listHeaderLabel = effectiveSearchQuery
    ? 'Search results'
    : (REGISTRY_SCOPE_LABELS[registryScope] || REGISTRY_SCOPE_LABELS[DEFAULT_REGISTRY_SCOPE]);

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="Patient Registry"
        description="Search and browse all patients in a sortable registry table"
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

        <div className="flex flex-wrap items-center gap-2 mt-4">
          {REGISTRY_SCOPE_TABS.map((scopeTab) => (
            <Button
              key={scopeTab.value}
              type="button"
              variant={registryScope === scopeTab.value ? "default" : "outline"}
              size="sm"
              onClick={() => handleRegistryScopeChange(scopeTab.value)}
              className={cn(
                "font-mono text-xs",
                registryScope === scopeTab.value
                  ? "bg-foreground text-background hover:bg-foreground/90"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {scopeTab.label}
            </Button>
          ))}
        </div>

        {/* Search Bar */}
        <div className="flex flex-col gap-3 mt-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative w-full sm:max-w-3xl lg:max-w-4xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Label htmlFor="patient-search" className="sr-only">Search by name, MRN, or NHIS ID</Label>
              <Input
                id="patient-search"
                placeholder="Search by name, MRN, or NHIS ID..."
                value={searchQuery}
                onChange={handleSearchChange}
                className="pl-10 pr-10 font-mono text-sm bg-background"
              />
              {hasSearchQuery && (
                <button
                  type="button"
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

          {hasSearchSignal && (
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
            <Search className="h-4 w-4" aria-hidden="true" />
            <h2 className="font-heading text-sm font-medium text-foreground">
              {listHeaderLabel}
            </h2>
            <span className="text-xs">({searchTotalLabel})</span>
          </div>
          {listControls}
        </div>
        <SearchResultsSection
          patients={searchPatients}
          isLoading={isSearchLoading}
          searchQuery={effectiveSearchQuery}
          hasActiveFilters={hasActiveFilters}
          ordering={searchOrdering}
          onOrderingChange={handleSearchOrderingChange}
          pagination={searchPagination}
          onPageChange={handleSearchPageChange}
          onOpenPatient={handleOpenPatient}
          onPointerDownPatient={handlePointerDownPatient}
        />
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
  ordering,
  onOrderingChange,
  pagination,
  onPageChange,
  onOpenPatient,
  onPointerDownPatient,
}) => {
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

  return (
    <SearchResultsTable
      patients={uniquePatients}
      ordering={ordering}
      onOrderingChange={onOrderingChange}
      pagination={pagination}
      onPageChange={onPageChange}
      onOpenPatient={onOpenPatient}
      onPointerDownPatient={onPointerDownPatient}
      isLoading={isLoading}
      searchQuery={searchQuery}
      hasActiveFilters={hasActiveFilters}
    />
  );
};

const SortableTableHead = ({ column, ordering, onOrderingChange }) => {
  const isDescending = ordering === `-${column.key}`;
  const isAscending = ordering === column.key;
  const isActive = isDescending || isAscending;

  return (
    <TableHead className="h-11">
      <button
        type="button"
        onClick={() => onOrderingChange(column.key)}
        className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        aria-label={`Sort by ${column.label}`}
      >
        <span>{column.label}</span>
        {isActive ? (
          isDescending ? (
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden="true" />
        )}
      </button>
    </TableHead>
  );
};

const SearchResultsTable = ({
  patients,
  ordering,
  onOrderingChange,
  pagination,
  onPageChange,
  onOpenPatient,
  onPointerDownPatient,
  isLoading,
  searchQuery,
  hasActiveFilters,
}) => {
  const emptyDescription = searchQuery
    ? `No patients match "${searchQuery}". Try a different search term.`
    : hasActiveFilters
      ? 'No patients match these filters. Try adjusting your criteria.'
      : 'No patients found.';
  const {
    currentPage,
    pageSize,
    totalPages,
    totalResults,
    totalResultsExact,
    hasNextPage,
    hasPreviousPage,
  } = pagination;
  const footerResultLabel = formatFooterResultLabel({
    currentPage,
    pageSize,
    visibleCount: patients.length,
    totalResults,
    isExact: totalResultsExact,
    hasNextPage,
  });
  const footerPageLabel = formatFooterPageLabel({
    currentPage,
    totalPages,
    isExact: totalResultsExact,
    hasNextPage,
  });

  const renderMobileRows = () => {
    if (isLoading) {
      return (
        <div className="space-y-3 md:hidden">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={`mobile-loading-row-${index}`} className="rounded-lg border border-border/60 bg-card p-3">
              <div className="h-3.5 w-2/3 rounded bg-muted/70 animate-pulse" />
              <div className="mt-3 grid gap-2">
                <div className="h-3 w-full rounded bg-muted/50 animate-pulse" />
                <div className="h-3 w-1/2 rounded bg-muted/50 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (patients.length === 0) {
      return (
        <div className="rounded-lg border border-border/60 bg-card p-8 text-center md:hidden">
          <Search className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted-foreground">{emptyDescription}</p>
        </div>
      );
    }

    return (
      <div className="space-y-3 md:hidden">
        {patients.map(({ patient, originalIndex }, index) => {
          const patientId = getPatientId(patient);
          const rowKey = patientId ? `mobile-${patientId}` : `mobile-${originalIndex}-${index}`;
          const age = getPatientAge(patient?.date_of_birth);
          const dobLabel = formatDateLabel(patient?.date_of_birth);
          const dobWithAge = age === null ? dobLabel : `${dobLabel} · ${age}y`;
          const locationDisplay = getPatientLocationDisplay(patient);

          return (
            <button
              key={rowKey}
              type="button"
              className="block w-full rounded-lg border border-border/60 bg-card p-3 text-left shadow-sm transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              data-onboarding={index === 0 ? 'patient-list-row' : undefined}
              onPointerDown={() => onPointerDownPatient(patient)}
              onClick={() => onOpenPatient(patient)}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {patient?.name || 'Unknown Patient'}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {patient?.medical_record_number || '—'}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                  {formatAdmissionStatus(patient?.registry_status || patient?.admission_status)}
                </Badge>
              </div>
              <dl className="mt-3 grid gap-2 text-xs">
                <div className="grid grid-cols-[6rem_1fr] gap-3">
                  <dt className="font-mono uppercase text-muted-foreground">Registered</dt>
                  <dd className="min-w-0 text-foreground">{formatDateLabel(patient?.created_at)}</dd>
                </div>
                <div className="grid grid-cols-[6rem_1fr] gap-3">
                  <dt className="font-mono uppercase text-muted-foreground">DOB / Age</dt>
                  <dd className="min-w-0 text-foreground">{dobWithAge}</dd>
                </div>
                <div className="grid grid-cols-[6rem_1fr] gap-3">
                  <dt className="font-mono uppercase text-muted-foreground">Location</dt>
                  <dd className="min-w-0 text-foreground">{locationDisplay.label}</dd>
                </div>
              </dl>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card">
      {renderMobileRows()}
      <div className="hidden overflow-x-auto md:block">
      <Table className="min-w-[920px]">
        <TableHeader className="bg-muted/30">
          <TableRow>
            {TABLE_COLUMNS.map((column) => (
              <SortableTableHead
                key={column.key}
                column={column}
                ordering={ordering}
                onOrderingChange={onOrderingChange}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 6 }).map((_, index) => (
              <TableRow key={`loading-row-${index}`}>
                {TABLE_COLUMNS.map((column) => (
                  <TableCell key={`loading-cell-${column.key}-${index}`}>
                    <div className="h-3.5 w-full max-w-[120px] rounded bg-muted/70 animate-pulse" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : patients.length === 0 ? (
            <TableRow>
              <TableCell colSpan={TABLE_COLUMNS.length} className="py-12 text-center">
                <div className="flex flex-col items-center gap-2">
                  <Search className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">{emptyDescription}</p>
                </div>
              </TableCell>
            </TableRow>
          ) : patients.map(({ patient, originalIndex }, index) => {
              const patientId = getPatientId(patient);
              const rowKey = patientId ? `table-${patientId}` : `table-${originalIndex}-${index}`;
              const age = getPatientAge(patient?.date_of_birth);
              const dobLabel = formatDateLabel(patient?.date_of_birth);
              const dobWithAge = age === null ? dobLabel : `${dobLabel} · ${age}y`;
              const locationDisplay = getPatientLocationDisplay(patient);
            return (
              <TableRow
                key={rowKey}
                className="cursor-pointer"
                data-onboarding={index === 0 ? 'patient-list-row' : undefined}
                onPointerDown={() => onPointerDownPatient(patient)}
                onClick={() => onOpenPatient(patient)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenPatient(patient);
                  }
                }}
                tabIndex={0}
                aria-label={`Open ${patient?.name || 'patient'} chart`}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {formatDateLabel(patient?.created_at)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {patient?.medical_record_number || '—'}
                </TableCell>
                <TableCell className="font-medium text-sm">
                  {patient?.name || 'Unknown Patient'}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {dobWithAge}
                </TableCell>
                <TableCell className="text-xs">
                  {formatGender(patient?.gender)}
                </TableCell>
                <TableCell className="text-xs">
                  {!locationDisplay.tooltip ? (
                    locationDisplay.label
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="cursor-help underline decoration-dotted underline-offset-2"
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          {locationDisplay.label}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[320px] font-mono text-[10px]">
                        {locationDisplay.tooltip}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {formatAdmissionStatus(patient?.registry_status || patient?.admission_status)}
                  </Badge>
                </TableCell>
              </TableRow>
            );
            })
          }
        </TableBody>
      </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-3">
        <p className="text-xs font-mono text-muted-foreground">
          {footerResultLabel} · {footerPageLabel}
          {!totalResultsExact && hasNextPage ? ' · More available' : ''}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={!hasPreviousPage}
            className="font-mono text-xs"
          >
            <ChevronLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={!hasNextPage}
            className="font-mono text-xs"
          >
            Next
            <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PatientChronicleListPage;
