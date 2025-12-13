import { useState, useMemo } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import {
  useMyPatients,
  useRemoveFromMyPatients,
  useToggleMyPatientPin,
} from "@/hooks/useMyPatientsQueries";
import { useSearchPatients } from "@/hooks/usePatientQueries";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PatientChronicleCard } from "@/components/chronicle";
import {
  Search,
  Plus,
  Users,
  LayoutGrid,
  List,
  RefreshCw,
  X,
  Star,
  Pin,
} from "lucide-react";

/**
 * MyPatientsPage - Dedicated page for user's personal patient list
 *
 * Features:
 * - View manually curated patient list
 * - Pin/unpin patients
 * - Remove patients from list
 * - Filter by search query
 * - Sort by pinned first
 */
const MyPatientsPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("grid");

  // Fetch My Patients data
  const {
    data: myPatientsData,
    isLoading,
    refetch,
  } = useMyPatients();

  // Mutations
  const removeFromMyPatients = useRemoveFromMyPatients();
  const togglePin = useToggleMyPatientPin();

  // Process patient list
  const patients = useMemo(() => {
    const entries = myPatientsData?.results || myPatientsData || [];
    if (!Array.isArray(entries)) return [];

    // Transform entries to include metadata
    let patientList = entries.map(entry => ({
      ...entry.patient_details,
      _listEntryId: entry.id,
      _isPinned: entry.is_pinned,
      _listNotes: entry.notes,
      _addedAt: entry.added_at,
    }));

    // Sort: pinned first, then by added date
    patientList.sort((a, b) => {
      if (a._isPinned && !b._isPinned) return -1;
      if (!a._isPinned && b._isPinned) return 1;
      return new Date(b._addedAt) - new Date(a._addedAt);
    });

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      patientList = patientList.filter(p => {
        const name = getDisplayName(p).toLowerCase();
        const mrn = (p.medical_record_number || '').toLowerCase();
        return name.includes(query) || mrn.includes(query);
      });
    }

    return patientList;
  }, [myPatientsData, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    const entries = myPatientsData?.results || myPatientsData || [];
    const total = Array.isArray(entries) ? entries.length : 0;
    const pinned = Array.isArray(entries) ? entries.filter(e => e.is_pinned).length : 0;
    return { total, pinned };
  }, [myPatientsData]);

  // Event handlers
  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
  };

  const handleRemoveFromMyPatients = (patientId) => {
    removeFromMyPatients.mutate(patientId);
  };

  const handleTogglePin = (entryId) => {
    togglePin.mutate(entryId);
  };

  const handleStartRound = (patient) => {
    const patientId = patient?.id || patient?.patient_profile;
    if (patientId) {
      navigate(`/workflows/consultation?patient=${patientId}`);
    }
  };

  const handleAddPatient = () => {
    navigate('/patients');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-4 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4 sm:mb-6">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl text-foreground tracking-tight mb-1">
              My Patients
            </h1>
            <p className="text-sm text-muted-foreground">
              {stats.total} patients
              {stats.pinned > 0 && (
                <span className="ml-2">· {stats.pinned} pinned</span>
              )}
            </p>
          </div>

          <Button
            onClick={handleAddPatient}
            variant="outline"
            size="sm"
            className="font-mono text-xs w-full sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add from Registry
          </Button>
        </div>

        {/* Tab Navigation */}
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

        {/* Search and Controls */}
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter your patients..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="pl-10 pr-10 font-mono text-sm bg-background"
            />
            {searchQuery && (
              <button
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
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

            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              className="shrink-0 h-9 w-9"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Patient List */}
      <main className="p-4 sm:p-6">
        {isLoading ? (
          <LoadingSkeleton viewMode={viewMode} />
        ) : patients.length === 0 ? (
          <EmptyState hasSearch={!!searchQuery} onClear={handleClearSearch} />
        ) : (
          <div className={cn(
            viewMode === 'grid'
              ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
              : "space-y-4"
          )}>
            {patients.map((patient, index) => (
              <div key={patient._listEntryId || patient.id || index} className="relative">
                {/* Pinned indicator */}
                {patient._isPinned && (
                  <div className="absolute -top-2 -right-2 z-10">
                    <div className="bg-primary text-primary-foreground rounded-full p-1">
                      <Pin className="h-3 w-3" />
                    </div>
                  </div>
                )}

                <PatientChronicleCard
                  patient={patient}
                  index={index}
                  onStartRound={handleStartRound}
                  showMyPatientsActions={true}
                  isInMyPatients={true}
                  onRemoveFromMyPatients={handleRemoveFromMyPatients}
                  onTogglePin={() => handleTogglePin(patient._listEntryId)}
                  className={viewMode === 'list' ? 'max-w-none' : ''}
                />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

/**
 * LoadingSkeleton
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
        <div key={i} className="bg-card/50 border border-border rounded-2xl p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
};

/**
 * EmptyState
 */
const EmptyState = ({ hasSearch, onClear }) => {
  const navigate = useNavigate();

  if (hasSearch) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="font-display text-xl text-foreground mb-2">
          No matching patients
        </h3>
        <p className="text-muted-foreground text-sm mb-4 max-w-md">
          No patients in your list match your search.
        </p>
        <Button variant="outline" size="sm" onClick={onClear}>
          <X className="h-4 w-4 mr-2" />
          Clear Filter
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Star className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="font-display text-xl text-foreground mb-2">
        No patients in your list
      </h3>
      <p className="text-muted-foreground text-sm mb-4 max-w-md">
        Add patients to your personal list for quick access during ward rounds.
      </p>
      <Button onClick={() => navigate('/patients')}>
        <Plus className="h-4 w-4 mr-2" />
        Browse Patient Registry
      </Button>
    </div>
  );
};

// Helper function
const getDisplayName = (patient) => {
  if (patient?.user_details) {
    const { first_name, last_name } = patient.user_details;
    return `${first_name || ''} ${last_name || ''}`.trim() || "Unknown";
  }
  return "Unknown";
};

export default MyPatientsPage;
