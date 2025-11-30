import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { usePatient } from "@/hooks/usePatientQueries";
import { toast } from "sonner";
import { usePatientTimeline, flattenTimelinePages, getTimelineTotalCount, useInvalidateTimeline } from "@/hooks/useTimelineQueries";
import { usePatientEncounters } from "@/hooks/useEncounterQueries";
import { useClinicalSummary } from "@/hooks/useClinicalSummaryQueries";
import { useMultipleSlideOvers } from "@/hooks/useSlideOver";
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
import LabOrderForm from "@/components/laboratory/LabOrderForm";
import ReferralForm from "@/components/referrals/ReferralForm";
import {
  Clock,
  FileText,
  Pill,
  TestTube,
  Activity,
  Filter,
  RefreshCw,
  Search,
  Loader2,
  Calendar,
  Building2,
  ChevronDown,
  ChevronRight,
  AlertCircle
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [expandedEncounters, setExpandedEncounters] = useState(new Set(['unlinked'])); // Track which encounter groups are expanded

  // Copy forward state - holds template and data for pre-filling note editor
  const [copyForwardData, setCopyForwardData] = useState(null);

  // Check for action query params (e.g., from referral inbox)
  const actionParam = searchParams.get('action');
  const referralIdParam = searchParams.get('referral_id');

  // Slide-over management - auto-collapses sidebar when any slide-over opens
  const slideOvers = useMultipleSlideOvers(['note', 'vitals', 'prescription', 'labs', 'referral']);

  // Auto-open slide-over based on action query param
  useEffect(() => {
    if (actionParam === 'add_note') {
      slideOvers.open('note');
      // Clear the query params after opening
      setSearchParams({}, { replace: true });
    }
  }, [actionParam, slideOvers, setSearchParams]);

  // Debounce search input
  const debouncedSearch = useDebounce(searchInput, 300);

  // Check if any slide-over is open (for timeline compression)
  const isAnySlideOverOpen = slideOvers.activeSlideOver !== null;

  // Fetch patient data
  const { data: patient, isLoading, error, refetch } = usePatient(id);

  // Fetch patient encounters for grouping
  const { data: encounters } = usePatientEncounters(id);

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
            ...entry.data,  // Preserve all original data including status, id, etc.
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

  // Find the active encounter (in-progress inpatient admission takes priority)
  const activeEncounter = useMemo(() => {
    if (!encounters || encounters.length === 0) return null;

    // First look for an active inpatient admission
    const activeInpatient = encounters.find(enc =>
      enc.status === 'in-progress' &&
      ['inpatient', 'admission', 'emergency', 'hospitalization'].includes(enc.encounter_type?.toLowerCase())
    );

    if (activeInpatient) return activeInpatient;

    // Otherwise look for any in-progress encounter
    const activeAny = encounters.find(enc => enc.status === 'in-progress');
    return activeAny || null;
  }, [encounters]);

  // Group entries by encounter
  const groupedByEncounter = useMemo(() => {
    // Create a map of encounter_id -> encounter details
    const encounterMap = new Map();
    if (encounters) {
      encounters.forEach(enc => {
        encounterMap.set(enc.id, enc);
      });
    }

    // Group entries
    const groups = {
      encounters: [], // Array of { encounter, entries }
      unlinked: []    // Entries without an encounter
    };

    // Temporary map to collect entries by encounter
    const encounterEntries = new Map();

    filteredEntries.forEach(entry => {
      const encounterId = entry.encounter_id || entry.encounter?.id;

      if (encounterId) {
        if (!encounterEntries.has(encounterId)) {
          encounterEntries.set(encounterId, []);
        }
        encounterEntries.get(encounterId).push(entry);
      } else {
        groups.unlinked.push(entry);
      }
    });

    // Convert to array and attach encounter details
    encounterEntries.forEach((entries, encounterId) => {
      // Get encounter details from map or from first entry
      const encounter = encounterMap.get(encounterId) ||
                       entries[0]?.encounter ||
                       { id: encounterId, type: 'unknown', status: 'unknown' };

      groups.encounters.push({
        encounter,
        entries: entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      });
    });

    // Sort encounters by start_time (most recent first)
    groups.encounters.sort((a, b) => {
      const dateA = new Date(a.encounter.start_time || a.entries[0]?.timestamp);
      const dateB = new Date(b.encounter.start_time || b.entries[0]?.timestamp);
      return dateB - dateA;
    });

    return groups;
  }, [filteredEntries, encounters]);

  // Toggle encounter expansion
  const toggleEncounter = useCallback((encounterId) => {
    setExpandedEncounters(prev => {
      const next = new Set(prev);
      if (next.has(encounterId)) {
        next.delete(encounterId);
      } else {
        next.add(encounterId);
      }
      return next;
    });
  }, []);

  // Expand all encounters
  const expandAll = useCallback(() => {
    const allIds = new Set(['unlinked']);
    groupedByEncounter.encounters.forEach(g => allIds.add(g.encounter.id));
    setExpandedEncounters(allIds);
  }, [groupedByEncounter]);

  // Collapse all encounters
  const collapseAll = useCallback(() => {
    setExpandedEncounters(new Set());
  }, []);

  // Get total count for display
  const totalCount = useMemo(() => getTimelineTotalCount(timelineData), [timelineData]);

  // ============================================
  // Event handlers
  // ============================================

  // Refresh data after any slide-over action
  const refreshData = useCallback(() => {
    Promise.all([
      invalidateTimeline(id),
      refetch(),
      refetchClinical(),
    ]);
  }, [refetch, refetchClinical, id, invalidateTimeline]);

  // Slide-over handlers - using the centralized hook
  const handleAddNote = useCallback(() => slideOvers.open('note'), [slideOvers]);
  const handleRecordVitals = useCallback(() => slideOvers.open('vitals'), [slideOvers]);
  const handlePrescribe = useCallback(() => slideOvers.open('prescription'), [slideOvers]);
  const handleOrderLabs = useCallback(() => slideOvers.open('labs'), [slideOvers]);
  const handleRequestConsult = useCallback(() => slideOvers.open('referral'), [slideOvers]);

  // Close handler with data refresh
  const handleSlideOverClose = useCallback(() => {
    slideOvers.close();
    setCopyForwardData(null); // Clear copy forward data when closing
  }, [slideOvers]);

  // Created handlers - refresh data and close
  const handleNoteCreated = useCallback(() => {
    refreshData();
    slideOvers.close();
    setCopyForwardData(null); // Clear copy forward data after note is created
  }, [refreshData, slideOvers]);

  // Handle copy note from timeline - opens note editor with pre-filled data
  const handleCopyNote = useCallback((copyData) => {
    // copyData contains: { template, templateId, templateTitle, data, sectionsCopied }
    // Template is now included directly from the timeline entry
    if (!copyData.template) {
      toast.error("Cannot copy note", { description: "Template information is missing" });
      return;
    }

    setCopyForwardData({
      template: copyData.template,
      data: copyData.data,
      sectionsCopied: copyData.sectionsCopied,
    });
    slideOvers.open('note');
    toast.success("Note copied", {
      description: `${copyData.sectionsCopied?.length || 0} sections ready to edit`,
    });
  }, [slideOvers]);

  const handleVitalsRecorded = useCallback(() => {
    refreshData();
    slideOvers.close();
  }, [refreshData, slideOvers]);

  const handlePrescriptionCreated = useCallback(() => {
    refreshData();
    slideOvers.close();
  }, [refreshData, slideOvers]);

  const handleLabOrderCreated = useCallback(() => {
    refreshData();
    slideOvers.close();
  }, [refreshData, slideOvers]);

  const handleReferralCreated = useCallback(() => {
    refreshData();
    slideOvers.close();
  }, [refreshData, slideOvers]);

  // Schedule Follow-up handler (navigate to appointments page)
  const handleScheduleFollowUp = useCallback(() => {
    navigate(`/appointments/create?patient=${id}`);
  }, [navigate, id]);

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
        onOrderLabs={handleOrderLabs}
        onRequestConsult={handleRequestConsult}
        onScheduleFollowUp={handleScheduleFollowUp}
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

              {/* Expand/Collapse All */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={expandAll}
                  className="font-mono text-xs h-8 px-2"
                >
                  Expand All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={collapseAll}
                  className="font-mono text-xs h-8 px-2"
                >
                  Collapse
                </Button>
              </div>
            </div>
          </div>

          {/* Timeline Entries Grouped by Encounter */}
          <div className="relative space-y-4">
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

            {/* Encounter Groups */}
            {groupedByEncounter.encounters.map(({ encounter, entries }) => {
              const isExpanded = expandedEncounters.has(encounter.id);
              const encounterDate = encounter.start_time
                ? new Date(encounter.start_time).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })
                : 'Unknown date';

              const encounterEndDate = encounter.end_time
                ? new Date(encounter.end_time).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric'
                  })
                : null;

              const dateRange = encounterEndDate && encounterEndDate !== encounterDate
                ? `${encounterDate} - ${encounterEndDate}`
                : encounterDate;

              const typeIcon = encounter.type === 'inpatient' ? Building2 : Calendar;
              const TypeIcon = typeIcon;

              return (
                <div key={encounter.id} className="border border-border rounded-lg overflow-hidden bg-card">
                  {/* Encounter Header */}
                  <button
                    onClick={() => toggleEncounter(encounter.id)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-accent/50 transition-colors text-left"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}

                    <div className={cn(
                      "p-2 rounded-lg",
                      encounter.type === 'inpatient' ? "bg-blue-500/10" : "bg-amber-500/10"
                    )}>
                      <TypeIcon className={cn(
                        "h-4 w-4",
                        encounter.type === 'inpatient' ? "text-blue-500" : "text-amber-500"
                      )} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm capitalize">
                          {encounter.encounter_type === 'inpatient' ? 'Inpatient Admission' :
                           encounter.encounter_type === 'emergency' ? 'Emergency Visit' : 'Outpatient Visit'}
                        </span>
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-xs font-mono",
                          encounter.status === 'finished' && "bg-muted text-muted-foreground",
                          encounter.status === 'in-progress' && "bg-green-500/10 text-green-600",
                          encounter.status === 'cancelled' && "bg-red-500/10 text-red-600"
                        )}>
                          {encounter.status}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        <span>{dateRange}</span>
                        {encounter.practitioner_name && (
                          <>
                            <span>•</span>
                            <span>{encounter.practitioner_name}</span>
                          </>
                        )}
                        {encounter.location && (
                          <>
                            <span>•</span>
                            <span>{encounter.location}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                      {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                    </span>
                  </button>

                  {/* Encounter Entries */}
                  {isExpanded && (
                    <div className="border-t border-border px-4 py-3 space-y-3">
                      {entries.map((entry, index) => (
                        <TimelineEntry
                          key={entry.id}
                          entry={entry}
                          index={index}
                          onCopyNote={handleCopyNote}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Unlinked Entries */}
            {groupedByEncounter.unlinked.length > 0 && (
              <div className="border border-dashed border-border rounded-lg overflow-hidden bg-card/50">
                {/* Unlinked Header */}
                <button
                  onClick={() => toggleEncounter('unlinked')}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-accent/50 transition-colors text-left"
                >
                  {expandedEncounters.has('unlinked') ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}

                  <div className="p-2 rounded-lg bg-muted">
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-muted-foreground">
                        Unlinked Entries
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Legacy data without encounter context
                    </div>
                  </div>

                  <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    {groupedByEncounter.unlinked.length} {groupedByEncounter.unlinked.length === 1 ? 'entry' : 'entries'}
                  </span>
                </button>

                {/* Unlinked Entries List */}
                {expandedEncounters.has('unlinked') && (
                  <div className="border-t border-dashed border-border px-4 py-3 space-y-3">
                    {groupedByEncounter.unlinked.map((entry, index) => (
                      <TimelineEntry
                        key={entry.id}
                        entry={entry}
                        index={index}
                        onCopyNote={handleCopyNote}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

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
          open={slideOvers.isOpen('note')}
          onClose={handleSlideOverClose}
          patient={patient}
          encounter={activeEncounter}
          onNoteCreated={handleNoteCreated}
          initialTemplate={copyForwardData?.template}
          initialData={copyForwardData?.data}
        />

        {/* Add Vitals Slide-Over Panel */}
        <AddVitalsSlideOver
          open={slideOvers.isOpen('vitals')}
          onClose={handleSlideOverClose}
          patient={patient}
          encounter={activeEncounter}
          onVitalsRecorded={handleVitalsRecorded}
        />

        {/* Add Prescription Slide-Over Panel */}
        <AddPrescriptionSlideOver
          open={slideOvers.isOpen('prescription')}
          onClose={handleSlideOverClose}
          patient={patient}
          encounter={activeEncounter}
          onPrescriptionCreated={handlePrescriptionCreated}
        />

        {/* Lab Order Form Slide-Over */}
        <LabOrderForm
          open={slideOvers.isOpen('labs')}
          onClose={handleSlideOverClose}
          patient={patient}
          encounter={activeEncounter}
          onOrderCreated={handleLabOrderCreated}
        />

        {/* Referral/Consult Form Slide-Over */}
        <ReferralForm
          open={slideOvers.isOpen('referral')}
          onClose={handleSlideOverClose}
          patient={patient}
          encounter={activeEncounter}
          onReferralCreated={handleReferralCreated}
        />
      </div>
    </div>
  );
};

export default PatientChroniclePage;
