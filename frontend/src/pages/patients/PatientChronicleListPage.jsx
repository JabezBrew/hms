import { useState, useMemo, useEffect } from "react";
import { useNavigate, NavLink, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSearchPatients,
  useRecentPatients,
  useContextPatients,
} from "@/hooks/usePatientQueries";
import {
  useAddToMyPatients,
} from "@/hooks/useMyPatientsQueries";
import { myPatientsKeys } from "@/hooks/useMyPatientsQueries";
import { patientsApi } from "@/lib/api/patients";
import { useAuth } from "@/lib/auth";
import { cn, normalizeApiResults } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PatientChronicleCard } from "@/components/chronicle";
import RecentPatientsSection from "@/components/patients/RecentPatientsSection";
import ContextPatientsSection from "@/components/patients/ContextPatientsSection";
import {
  Search,
  Plus,
  Users,
  LayoutGrid,
  List,
  RefreshCw,
  X,
  Star,
} from "lucide-react";

// Clinical provider roles that can access "My Patients" feature
const CLINICAL_PROVIDER_ROLES = ['doctor', 'nurse', 'lab_technician', 'pharmacist'];

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
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("grid");

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
      navigate(`/workflows/consultation?patient=${patientId}`);
    }
  };

  const handleAddToMyPatients = (patientId) => {
    addToMyPatients.mutate({ patientId });
  };

  // Loading state
  const isLoading = isSearching ? isSearchLoading : (isRecentLoading || isContextLoading);

  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-4 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4 sm:mb-6">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl text-foreground tracking-tight mb-1">
              Patient Registry
            </h1>
            <p className="text-sm text-muted-foreground">
              Search for patients or browse your recent and assigned patients
            </p>
          </div>

          {/* Only admin and receptionist can register patients */}
          {['admin', 'receptionist'].includes(user?.role) && (
            <Button onClick={handleAddPatient} size="sm" className="font-mono text-xs w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-2" />
              Register Patient
            </Button>
          )}
        </div>

        {/* Tab Navigation - Using NavLinks for routes */}
        {isClinicalProvider && (
          <div className="flex items-center gap-1 mb-4 bg-muted rounded-lg p-1 w-fit">
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
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, MRN, or NHIS ID (min 2 characters)..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="pl-10 pr-10 font-mono text-sm bg-background"
            />
            {hasSearchQuery && (
              <button
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
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
              <div className="flex bg-muted rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('grid')}
                  className={cn(
                    "p-1.5 rounded-md transition-colors",
                    viewMode === 'grid'
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={cn(
                    "p-1.5 rounded-md transition-colors",
                    viewMode === 'list'
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>

              {/* Refresh */}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                className="shrink-0 h-9 w-9"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

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
              onAddToMyPatients={handleAddToMyPatients}
              showMyPatientsActions={isClinicalProvider}
            />

          </>
        )}
      </main>
    </div>
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
          onAddToMyPatients={onAddToMyPatients}
          showMyPatientsActions={showMyPatientsActions}
          className={viewMode === 'list' ? 'max-w-none' : ''}
        />
      ))}
    </div>
  );
};

export default PatientChronicleListPage;
