import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { usePatient } from "@/hooks/usePatientQueries";
import { usePatientTimeline, flattenTimelinePages, getTimelineTotalCount, useInvalidateTimeline } from "@/hooks/useTimelineQueries";
import { useClinicalSummary } from "@/hooks/useClinicalSummaryQueries";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PatientIdentityHero,
  ClinicalSummarySidebar,
  TimelineEntry,
  TimelineGroup,
  AddNoteSlideOver,
  AddVitalsSlideOver,
  AddPrescriptionSlideOver
} from "@/components/chronicle";
import {
  Clock,
  FileText,
  Pill,
  TestTube,
  Activity,
  Filter,
  RefreshCw,
  Search,
  Loader2
} from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";

/**
 * PatientChroniclePage - Magazine-style patient health record view
 *
 * Layout:
 * - Hero header with patient identity
 * - Two-column layout: Clinical Summary | Timeline Chronicle
 * - Timeline with filterable entries
 */
const PatientChroniclePage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [isAddNoteOpen, setIsAddNoteOpen] = useState(false);
  const [isAddVitalsOpen, setIsAddVitalsOpen] = useState(false);
  const [isAddPrescriptionOpen, setIsAddPrescriptionOpen] = useState(false);

  // Debounce search input
  const debouncedSearch = useDebounce(searchInput, 300);

  // Check if any slide-over is open (for timeline compression)
  const isAnySlideOverOpen = isAddNoteOpen || isAddVitalsOpen || isAddPrescriptionOpen;

  // Fetch patient data
  const { data: patient, isLoading, error, refetch } = usePatient(id);

  // Get patient ID for clinical queries - use URL id directly to enable parallel loading
  // The URL id is the patient UUID which works for all clinical endpoints
  const patientLocalId = patient?.local_data?.id || patient?.id || id;

  // Fetch clinical summary data (medications, vitals/labs)
  // Uses id from URL params to start fetching immediately in parallel with patient data
  const {
    medications,
    labResults,
    allergies: parsedAllergies,
    problems,
    isLoading: isClinicalLoading,
    refetch: refetchClinical,
  } = useClinicalSummary(id, patient?.local_data || patient, {
    enabled: !!id, // Use URL id to start immediately
  });

  // Map filter to API type
  const typeMapping = {
    'all': 'all',
    'progress_note': 'notes',
    'vitals': 'vitals',
    'medication': 'prescriptions',
    'lab_result': 'all', // No specific lab results endpoint yet
  };

  // Fetch timeline with infinite scroll
  // Uses id from URL params to start fetching immediately in parallel with patient data
  const {
    data: timelineData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isTimelineLoading,
    error: timelineError,
    refetch: refetchTimeline,
  } = usePatientTimeline(id, {
    type: typeMapping[activeFilter] || 'all',
    search: debouncedSearch,
    pageSize: 20,
  });

  // Invalidate timeline cache helper
  const invalidateTimeline = useInvalidateTimeline();

  // Infinite scroll ref
  const loadMoreRef = useRef(null);

  // Set up intersection observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ============================================
  // Transform API data for timeline components
  // ============================================

  const timelineEntries = useMemo(() => {
    if (!timelineData) return [];

    const flatEntries = flattenTimelinePages(timelineData);

    // Transform API entries to match TimelineEntry component format
    return flatEntries.map(entry => {
      // Map entry_type to display type
      let displayType = entry.type;

      // Handle prescription type
      if (entry.entry_type === 'prescription') {
        displayType = 'medication';
      }

      // Transform vitals data to match expected format
      if (entry.entry_type === 'vitals' && entry.data) {
        return {
          ...entry,
          type: 'vitals',
          data: {
            temperature: entry.data.temperature,
            blood_pressure: entry.data.blood_pressure,
            heart_rate: entry.data.heart_rate,
            spo2: entry.data.oxygen_saturation,
            respiratory_rate: entry.data.respiratory_rate,
            pain_level: entry.data.pain_level,
          }
        };
      }

      // Transform prescription data to medication format
      if (entry.entry_type === 'prescription' && entry.data) {
        return {
          ...entry,
          type: 'medication',
          data: {
            name: entry.data.medication_name,
            dose: entry.data.dosage,
            route: entry.data.route_display,
            frequency: entry.data.frequency_display,
            notes: entry.data.instructions,
          }
        };
      }

      return {
        ...entry,
        type: displayType,
      };
    });
  }, [timelineData]);

  // Use allergies from clinical summary hook (already parsed from patient data)
  // The hook handles parsing from string/array formats
  const allergies = parsedAllergies;

  // ============================================
  // Filter entries (filtering is done by API, but we keep this for local display type mapping)
  // ============================================

  const filteredEntries = useMemo(() => {
    // If filtering for specific types not supported by API, filter locally
    if (activeFilter === 'progress_note') {
      return timelineEntries.filter(entry =>
        entry.type === 'progress_note' ||
        entry.type === 'soap_note' ||
        entry.type === 'admission_note' ||
        entry.type === 'discharge_note' ||
        entry.type === 'consult_note' ||
        entry.type === 'nursing_note'
      );
    }
    if (activeFilter === 'lab_result') {
      return timelineEntries.filter(entry => entry.type === 'lab_result');
    }
    return timelineEntries;
  }, [timelineEntries, activeFilter]);

  // Group entries by date
  const groupedEntries = useMemo(() => {
    const groups = {};
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();

    filteredEntries.forEach(entry => {
      const entryDate = new Date(entry.timestamp).toDateString();
      let dateLabel;

      if (entryDate === today) {
        dateLabel = 'Today';
      } else if (entryDate === yesterday) {
        dateLabel = 'Yesterday';
      } else {
        dateLabel = new Date(entry.timestamp).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric'
        });
      }

      if (!groups[dateLabel]) {
        groups[dateLabel] = [];
      }
      groups[dateLabel].push(entry);
    });

    return groups;
  }, [filteredEntries]);

  // Get total count for display
  const totalCount = useMemo(() => getTimelineTotalCount(timelineData), [timelineData]);

  // ============================================
  // Event handlers
  // ============================================

  const handleAddNote = useCallback(() => {
    setIsAddNoteOpen(true);
  }, []);

  const handleCloseAddNote = useCallback(() => {
    setIsAddNoteOpen(false);
  }, []);

  const handleNoteCreated = useCallback(() => {
    // Refresh timeline and clinical data in parallel when a note is created
    Promise.all([
      invalidateTimeline(id),
      refetch(),
      refetchClinical(),
    ]);
    setIsAddNoteOpen(false);
  }, [refetch, refetchClinical, id, invalidateTimeline]);

  const handleRecordVitals = useCallback(() => {
    setIsAddVitalsOpen(true);
  }, []);

  const handleCloseVitals = useCallback(() => {
    setIsAddVitalsOpen(false);
  }, []);

  const handleVitalsRecorded = useCallback(() => {
    // Refresh timeline and clinical data in parallel
    Promise.all([
      invalidateTimeline(id),
      refetch(),
      refetchClinical(),
    ]);
    setIsAddVitalsOpen(false);
  }, [refetch, refetchClinical, id, invalidateTimeline]);

  const handlePrescribe = useCallback(() => {
    setIsAddPrescriptionOpen(true);
  }, []);

  const handleClosePrescription = useCallback(() => {
    setIsAddPrescriptionOpen(false);
  }, []);

  const handlePrescriptionCreated = useCallback(() => {
    // Refresh timeline and clinical data in parallel
    Promise.all([
      invalidateTimeline(id),
      refetch(),
      refetchClinical(),
    ]);
    setIsAddPrescriptionOpen(false);
  }, [refetch, refetchClinical, id, invalidateTimeline]);

  // ============================================
  // Loading state
  // ============================================

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        {/* Hero skeleton */}
        <div className="bg-card border-b border-border px-6 py-8">
          <Skeleton className="h-12 w-64 mb-4" />
          <Skeleton className="h-4 w-96 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>

        {/* Content skeleton */}
        <div className="flex">
          <div className="w-80 border-r border-border p-6 space-y-6">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className="flex-1 p-6 space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // Error state
  // ============================================

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-display text-foreground">
            Unable to load patient record
          </h2>
          <p className="text-muted-foreground">
            {error.message || 'An error occurred while fetching patient data.'}
          </p>
          <Button onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // ============================================
  // Render
  // ============================================

  return (
    <div className="min-h-screen bg-background">
      {/* Patient Identity Hero */}
      <PatientIdentityHero
        patient={patient}
        onAddNote={handleAddNote}
        onRecordVitals={handleRecordVitals}
        onPrescribe={handlePrescribe}
      />

      {/* Main Content: Sidebar + Timeline */}
      <div className={cn(
        "flex transition-all duration-300",
        isAnySlideOverOpen && "lg:mr-[50%]"
      )}>
        {/* Clinical Summary Sidebar */}
        <ClinicalSummarySidebar
          patient={patient}
          problems={problems}
          medications={medications}
          allergies={allergies}
          labResults={labResults}
          className={cn(
            "hidden lg:block",
            isAnySlideOverOpen && "lg:hidden" // Hide sidebar when any panel is open
          )}
        />

        {/* Timeline Chronicle */}
        <main className="flex-1 p-6 transition-all duration-300">
          {/* Timeline Header with Search and Filters */}
          <div className="space-y-4 mb-6">
            {/* Title and count */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <h2 className="font-display text-2xl text-foreground">
                  Clinical Chronicle
                </h2>
                {totalCount > 0 && (
                  <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    {totalCount} {totalCount === 1 ? 'entry' : 'entries'}
                  </span>
                )}
              </div>

              {/* Refresh button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetchTimeline()}
                className="font-mono text-xs"
              >
                <RefreshCw className={cn(
                  "h-3.5 w-3.5 mr-1.5",
                  isTimelineLoading && "animate-spin"
                )} />
                Refresh
              </Button>
            </div>

            {/* Search and Filter row */}
            <div className="flex items-center gap-4">
              {/* Search Input */}
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search notes, prescriptions..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-9 font-mono text-sm"
                />
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <div className="flex bg-muted rounded-lg p-1">
                  {[
                    { key: 'all', label: 'All', icon: null },
                    { key: 'progress_note', label: 'Notes', icon: FileText },
                    { key: 'vitals', label: 'Vitals', icon: Activity },
                    { key: 'medication', label: 'Meds', icon: Pill },
                    { key: 'lab_result', label: 'Labs', icon: TestTube }
                  ].map(filter => (
                    <button
                      key={filter.key}
                      onClick={() => setActiveFilter(filter.key)}
                      className={cn(
                        "px-3 py-1.5 rounded-md font-mono text-xs transition-colors",
                        "flex items-center gap-1.5",
                        activeFilter === filter.key
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {filter.icon && <filter.icon className="h-3 w-3" />}
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Timeline Entries */}
          <div className="relative">
            {/* Loading state for initial load */}
            {isTimelineLoading && filteredEntries.length === 0 && (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="pl-8 pb-6">
                    <Skeleton className="h-32 w-full rounded-xl" />
                  </div>
                ))}
              </div>
            )}

            {/* Entries grouped by date */}
            {Object.entries(groupedEntries).map(([date, entries], groupIndex) => (
              <TimelineGroup
                key={date}
                date={date}
                entries={entries}
                startIndex={groupIndex * 10}
              />
            ))}

            {/* Empty state */}
            {!isTimelineLoading && filteredEntries.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p className="font-mono text-sm">
                  {searchInput ? 'No entries match your search' : 'No entries found'}
                </p>
                {searchInput && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSearchInput('')}
                    className="mt-2 font-mono text-xs"
                  >
                    Clear search
                  </Button>
                )}
              </div>
            )}

            {/* Infinite scroll trigger */}
            {hasNextPage && (
              <div
                ref={loadMoreRef}
                className="flex items-center justify-center py-8"
              >
                {isFetchingNextPage ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="font-mono text-xs">Loading more...</span>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchNextPage()}
                    className="font-mono text-xs"
                  >
                    Load more
                  </Button>
                )}
              </div>
            )}

            {/* End of timeline indicator */}
            {!hasNextPage && filteredEntries.length > 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <div className="w-12 h-px bg-border mx-auto mb-2" />
                <p className="font-mono text-xs">End of timeline</p>
              </div>
            )}
          </div>
        </main>

        {/* Add Note Slide-Over Panel */}
        <AddNoteSlideOver
          open={isAddNoteOpen}
          onClose={handleCloseAddNote}
          patient={patient}
          onNoteCreated={handleNoteCreated}
        />

        {/* Add Vitals Slide-Over Panel */}
        <AddVitalsSlideOver
          open={isAddVitalsOpen}
          onClose={handleCloseVitals}
          patient={patient}
          onVitalsRecorded={handleVitalsRecorded}
        />

        {/* Add Prescription Slide-Over Panel */}
        <AddPrescriptionSlideOver
          open={isAddPrescriptionOpen}
          onClose={handleClosePrescription}
          patient={patient}
          onPrescriptionCreated={handlePrescriptionCreated}
        />
      </div>
    </div>
  );
};

export default PatientChroniclePage;
