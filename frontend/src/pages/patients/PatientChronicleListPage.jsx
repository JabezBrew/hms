import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { usePatients, useSearchPatients } from "@/hooks/usePatientQueries";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PatientChronicleCard } from "@/components/chronicle";
import {
  Search,
  Plus,
  Users,
  Filter,
  LayoutGrid,
  List,
  RefreshCw,
  X
} from "lucide-react";

/**
 * PatientChronicleListPage - Magazine-style patient list
 *
 * Features:
 * - Chronicle-style patient cards
 * - Search and filter functionality
 * - Toggle between grid and list views
 * - Staggered animations on load
 */
const PatientChronicleListPage = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWard, setSelectedWard] = useState("all");
  const [viewMode, setViewMode] = useState("grid"); // 'grid' or 'list'

  // Fetch patients
  const {
    data: searchResults,
    isLoading: isSearchLoading,
    setSearchTerm,
    debouncedSearchTerm
  } = useSearchPatients();

  const {
    data: allPatientsData,
    isLoading: isAllPatientsLoading,
    refetch
  } = usePatients();

  const isLoading = isSearchLoading || isAllPatientsLoading;

  // ============================================
  // Data processing
  // ============================================

  // Get patients array from response
  const displayedPatients = useMemo(() => {
    const patients = debouncedSearchTerm
      ? (searchResults?.results || searchResults?.patients || [])
      : (allPatientsData?.results || allPatientsData?.patients || allPatientsData || []);

    return Array.isArray(patients) ? patients : [];
  }, [searchResults, allPatientsData, debouncedSearchTerm]);

  // Extract unique wards for filter
  const uniqueWards = useMemo(() => {
    return displayedPatients.reduce((wards, patient) => {
      const wardId = patient?.current_ward_id;
      const wardName = patient?.current_ward ||
        patient?.patient_profile_details?.current_ward;

      if (wardId && wardName && wardName !== "Not Admitted" && wardName !== "Waiting List") {
        if (!wards.find(w => w.id === wardId)) {
          wards.push({ id: wardId, name: wardName });
        }
      }
      return wards;
    }, []);
  }, [displayedPatients]);

  // Filter patients by ward
  const filteredPatients = useMemo(() => {
    if (selectedWard === "all") return displayedPatients;
    return displayedPatients.filter(patient =>
      patient?.current_ward_id === selectedWard
    );
  }, [displayedPatients, selectedWard]);

  // Calculate stats
  const stats = useMemo(() => {
    const total = filteredPatients.length;
    const critical = filteredPatients.filter(p => p?.is_critical).length;
    const admitted = filteredPatients.filter(p =>
      p?.current_ward && p.current_ward !== "Not Admitted"
    ).length;

    return { total, critical, admitted };
  }, [filteredPatients]);

  // ============================================
  // Event handlers
  // ============================================

  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    setSearchTerm(query);
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setSelectedWard("all");
    setSearchTerm("");
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

  const hasActiveFilters = searchQuery || selectedWard !== "all";

  // ============================================
  // Render
  // ============================================

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
              {stats.total} patients
              {stats.critical > 0 && (
                <span className="text-destructive ml-2">
                  · {stats.critical} critical
                </span>
              )}
              {stats.admitted > 0 && (
                <span className="text-muted-foreground ml-2">
                  · {stats.admitted} admitted
                </span>
              )}
            </p>
          </div>

          <Button onClick={handleAddPatient} size="sm" className="font-mono text-xs w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            Register Patient
          </Button>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col gap-3">
          {/* Search - Full Width */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, MRN, or NHIS ID..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="pl-10 font-mono text-sm bg-background"
            />
          </div>

          {/* Filters Row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Ward Filter */}
            <Select value={selectedWard} onValueChange={setSelectedWard}>
              <SelectTrigger className="w-full sm:w-[160px] font-mono text-xs h-9">
                <Filter className="h-3.5 w-3.5 mr-2" />
                <SelectValue placeholder="All Wards" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Wards</SelectItem>
                {uniqueWards.map((ward) => (
                  <SelectItem key={ward.id} value={ward.id}>
                    {ward.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* View Mode Toggle */}
            <div className="flex bg-muted rounded-lg p-0.5 ml-auto">
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
              onClick={() => refetch()}
              className="shrink-0 h-9 w-9"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>

            {/* Clear Filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="font-mono text-xs h-9"
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Patient List */}
      <main className="p-4 sm:p-6">
        {isLoading ? (
          <LoadingSkeleton viewMode={viewMode} />
        ) : filteredPatients.length === 0 ? (
          <EmptyState hasFilters={hasActiveFilters} onClear={handleClearFilters} />
        ) : (
          <div className={cn(
            viewMode === 'grid'
              ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
              : "space-y-4"
          )}>
            {filteredPatients.map((patient, index) => (
              <PatientChronicleCard
                key={patient?.id || patient?.patient_profile || index}
                patient={patient}
                index={index}
                onStartRound={handleStartRound}
                className={viewMode === 'list' ? 'max-w-none' : ''}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

/**
 * LoadingSkeleton - Skeleton loading state
 */
const LoadingSkeleton = ({ viewMode }) => {
  const count = viewMode === 'grid' ? 6 : 4;

  return (
    <div className={cn(
      viewMode === 'grid'
        ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
        : "space-y-4"
    )}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-card/50 border border-border rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
          <Skeleton className="h-16 w-full rounded-xl" />
          <div className="flex justify-between pt-4 border-t border-border">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * EmptyState - No patients found state
 */
const EmptyState = ({ hasFilters, onClear }) => {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Users className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="font-display text-xl text-foreground mb-2">
        {hasFilters ? 'No matching patients' : 'No patients registered'}
      </h3>
      <p className="text-muted-foreground text-sm mb-4 max-w-md">
        {hasFilters
          ? 'Try adjusting your search or filter criteria.'
          : 'Start by registering a new patient to see them appear here.'}
      </p>
      {hasFilters && (
        <Button variant="outline" size="sm" onClick={onClear}>
          <X className="h-4 w-4 mr-2" />
          Clear Filters
        </Button>
      )}
    </div>
  );
};

export default PatientChronicleListPage;
