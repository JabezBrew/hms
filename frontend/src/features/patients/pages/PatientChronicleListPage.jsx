import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js';
import List from 'lucide-react/dist/esm/icons/list.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Star from 'lucide-react/dist/esm/icons/star.js';
import { useState, useMemo, useEffect } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSearchPatients,
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
import { PatientChronicleCard } from "@/components/chronicle";
import RecentPatientsSection from "@/components/patients/RecentPatientsSection";
import ContextPatientsSection from "@/components/patients/ContextPatientsSection";
import { PageShell } from "@/shared/components/page/PageShell";
import { PageHeader } from "@/shared/components/page/PageHeader";
import { usePageMeta } from "@/shared/hooks/usePageMeta";

// Clinical provider roles that can access "My Patients" feature
const CLINICAL_PROVIDER_ROLES = ['doctor', 'nurse', 'head_nurse', 'nurse_practitioner', 'inpatient_doctor', 'practitioner', 'physician', 'lab_technician', 'pharmacist'];

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
  const pageMeta = usePageMeta({
    title: 'Patients | Hospital Management System',
    breadcrumbs: [{ label: 'Patients', path: '/patients' }],
  });

  // Check if user is a clinical provider
  const isClinicalProvider = CLINICAL_PROVIDER_ROLES.includes(user?.role);

  // Search patients (only when query has 2+ characters)
  const {
    data: searchResults,
    isLoading: isSearchLoading,
    setSearchTerm,
    debouncedSearchTerm,
  } = useSearchPatients();

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

  // Determine if we're showing search results
  const isSearching = debouncedSearchTerm && debouncedSearchTerm.length >= 2;
  const hasSearchQuery = searchQuery.length > 0;

  // Get search results
  const searchPatients = useMemo(() => {
    if (!isSearching) return [];
    return normalizeApiResults(searchResults);
  }, [searchResults, isSearching]);

  // Get recent patients array
  const recentPatients = useMemo(() => {
    return normalizeApiResults(recentPatientsData);
  }, [recentPatientsData]);

  // Event handlers
  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    setSearchTerm(query);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setSearchTerm("");
  };

  const handleRefresh = () => {
    refetchRecent();
    refetchContext();
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

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="Patient Registry"
        description="Search for patients or browse your recent and assigned patients"
        size="md"
        actions={['admin', 'receptionist'].includes(user?.role) ? (
          <Button onClick={handleAddPatient} size="sm" className="font-mono text-xs w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            Register Patient
          </Button>
        ) : null}
      >
        {/* Tab Navigation - Using NavLinks for routes */}
        {isClinicalProvider && (
          <div className="flex items-center gap-1 mt-4 bg-muted rounded-lg p-1 w-fit">
            <NavLink
              to="/patients"
              end
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
          <div className="relative">
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

          {/* Toolbar */}
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {isSearching && (
                <span>{searchPatients.length} results for "{debouncedSearchTerm}"</span>
              )}
            </div>

            <div className="flex items-center gap-2">
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
          </div>
        </div>
      </PageHeader>

      {/* Main Content */}
      <main className="p-4 sm:p-6 space-y-8">
        {isSearching ? (
          // Show search results
          <SearchResultsSection
            patients={searchPatients}
            isLoading={isSearchLoading}
            searchQuery={debouncedSearchTerm}
            viewMode={viewMode}
            onStartRound={handleStartRound}
            onStartConsultation={handleStartConsultation}
            onAddToMyPatients={handleAddToMyPatients}
            showMyPatientsActions={isClinicalProvider}
          />
        ) : (
          // Show recent + context patients
          <>
            <RecentPatientsSection
              patients={recentPatients}
              isLoading={isRecentLoading}
            />

            <ContextPatientsSection
              data={contextPatientsData}
              isLoading={isContextLoading}
              onStartRound={handleStartRound}
              onStartConsultation={handleStartConsultation}
              onAddToMyPatients={handleAddToMyPatients}
              showMyPatientsActions={isClinicalProvider}
            />

          </>
        )}
      </main>
    </PageShell>
  );
};

/**
 * SearchResultsSection - Display search results
 */
const SearchResultsSection = ({
  patients,
  isLoading,
  searchQuery,
  viewMode,
  onStartRound,
  onStartConsultation,
  onAddToMyPatients,
  showMyPatientsActions,
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
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="font-display text-xl text-foreground mb-2">
          No patients found
        </h3>
        <p className="text-muted-foreground text-sm max-w-md">
          No patients match "{searchQuery}". Try a different search term.
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

  return (
    <div className={cn(
      viewMode === 'grid'
        ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
        : "space-y-4"
    )}>
      {uniquePatients.map(({ patient, originalIndex }, index) => (
        <PatientChronicleCard
          key={`search-${patient?.id || originalIndex}-${index}`}
          patient={patient}
          index={index}
          onStartRound={onStartRound}
          onStartConsultation={onStartConsultation}
          onAddToMyPatients={onAddToMyPatients}
          showMyPatientsActions={showMyPatientsActions}
          className={viewMode === 'list' ? 'max-w-none' : ''}
        />
      ))}
    </div>
  );
};

export default PatientChronicleListPage;
