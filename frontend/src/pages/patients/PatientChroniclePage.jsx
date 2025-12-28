import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { usePatient } from "@/hooks/usePatientQueries";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";
import { usePatientTimeline, flattenTimelinePages, getTimelineTotalCount, useInvalidateTimeline } from "@/hooks/useTimelineQueries";
import { usePatientEncounters } from "@/hooks/useEncounterQueries";
// useClinicalSummary removed - context endpoint now provides all sidebar data
import { useChronicleContext, useTimelineV2 } from "@/hooks/useChronicleContext";
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
  AddPrescriptionSlideOver,
  AddFluidBalanceSlideOver,
  PatientInsuranceSlideOver,
  BreakGlassDialog,
} from "@/components/chronicle";
import { usePatientInsurance } from "@/hooks/useBillingQueries";
import { patientsApi } from "@/lib/api/patients";
import {
  AddChartSlideOver,
  ChartEntryForm,
  ChartAssignmentCard,
} from "@/components/charts";
import LabOrderForm from "@/components/laboratory/LabOrderForm";
import ReferralForm from "@/components/referrals/ReferralForm";
import { useChartAssignments } from "@/hooks/useChartQueries";
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
  AlertCircle,
  ClipboardList,
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
  const { user, loading: authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [expandedEncounters, setExpandedEncounters] = useState(new Set(['unlinked'])); // Track which encounter groups are expanded

  // Copy forward state - holds template and data for pre-filling note editor
  const [copyForwardData, setCopyForwardData] = useState(null);

  // Edit note state - holds note ID and data for editing existing notes
  const [editNoteData, setEditNoteData] = useState(null);

  const [isBreakGlassOpen, setBreakGlassOpen] = useState(false);
  const [breakGlassReason, setBreakGlassReason] = useState('');
  const [breakGlassExpiresAt, setBreakGlassExpiresAt] = useState(null);

  // Check for action query params (e.g., from referral inbox)
  const actionParam = searchParams.get('action');
  const referralIdParam = searchParams.get('referral_id');

  // Slide-over management - auto-collapses sidebar when any slide-over opens
  const slideOvers = useMultipleSlideOvers(['note', 'vitals', 'prescription', 'labs', 'referral', 'fluids', 'charts', 'chartEntry', 'insurance']);

  // Chart entry state - which assignment is being recorded
  const [activeChartAssignment, setActiveChartAssignment] = useState(null);

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

  // Fetch patient data (includes access flags for conditional fetching)
  const { data: patient, isLoading, error, refetch } = usePatient(id);

  // Check if user has clinical access (from patient endpoint response)
  const hasClinicalAccess = patient?.access?.clinical === true;

  // ====== TIER 1: Chronicle Context (optimized single-call) ======
  // Only fetch if user has clinical access - prevents wasted 403 requests
  const {
    data: chronicleContext,
    isLoading: isContextLoading,
    error: contextError,
    refetch: refetchContext,
  } = useChronicleContext(id, {
    enabled: hasClinicalAccess,
  });

  const canFetchClinical = hasClinicalAccess && !isContextLoading && !contextError;

  // Fetch patient encounters for grouping
  const { data: encounters, refetch: refetchEncounters } = usePatientEncounters(id, {
    enabled: canFetchClinical,
  });

  // Fetch patient insurance (only if user has clinical access)
  const { data: insuranceData } = usePatientInsurance(id, {}, {
    enabled: hasClinicalAccess,
  });
  const patientInsurance = insuranceData?.results || insuranceData || [];

  // Get patient ID for clinical queries - use URL id directly to enable parallel loading
  // The URL id is the patient UUID which works for all clinical endpoints
  const patientLocalId = patient?.local_data?.id || patient?.id || id;

  // Use chronicle context data directly - no more legacy fallback needed
  const medications = chronicleContext?.active_medications || [];
  const parsedAllergies = chronicleContext?.allergies || [];
  const problems = chronicleContext?.active_problems || [];
  const admissionStatus = chronicleContext?.admission_status;

  // Transform latest_vitals from context into labResults format for sidebar
  const labResults = useMemo(() => {
    const vitals = chronicleContext?.latest_vitals;
    if (!vitals) return [];

    const results = [];
    const timestamp = vitals.recorded_at;

    if (vitals.temperature) {
      const temp = parseFloat(vitals.temperature);
      results.push({
        id: `temp-${vitals.id}`,
        name: 'Temp',
        value: vitals.temperature,
        unit: '°C',
        timestamp,
        is_abnormal: temp > 38 || temp < 36,
        abnormal_direction: temp > 38 ? 'high' : 'low',
      });
    }

    if (vitals.heart_rate) {
      const hr = parseInt(vitals.heart_rate);
      results.push({
        id: `hr-${vitals.id}`,
        name: 'HR',
        value: vitals.heart_rate,
        unit: 'bpm',
        timestamp,
        is_abnormal: hr > 100 || hr < 60,
        abnormal_direction: hr > 100 ? 'high' : 'low',
      });
    }

    if (vitals.blood_pressure) {
      const parts = vitals.blood_pressure.split('/');
      const systolic = parts.length > 0 ? Number(parts[0]) : null;
      results.push({
        id: `bp-${vitals.id}`,
        name: 'BP',
        value: vitals.blood_pressure,
        unit: 'mmHg',
        timestamp,
        is_abnormal: systolic ? (systolic > 140 || systolic < 90) : false,
        abnormal_direction: systolic > 140 ? 'high' : 'low',
      });
    }

    if (vitals.oxygen_saturation) {
      const spo2 = parseInt(vitals.oxygen_saturation);
      results.push({
        id: `spo2-${vitals.id}`,
        name: 'SpO2',
        value: vitals.oxygen_saturation,
        unit: '%',
        timestamp,
        is_abnormal: spo2 < 95,
        abnormal_direction: 'low',
      });
    }

    if (vitals.respiratory_rate) {
      const rr = parseInt(vitals.respiratory_rate);
      results.push({
        id: `rr-${vitals.id}`,
        name: 'RR',
        value: vitals.respiratory_rate,
        unit: '/min',
        timestamp,
        is_abnormal: rr > 20 || rr < 12,
        abnormal_direction: rr > 20 ? 'high' : 'low',
      });
    }

    return results;
  }, [chronicleContext?.latest_vitals]);

  // Fetch active chart assignments for this patient
  const { data: chartAssignments, refetch: refetchCharts } = useChartAssignments(
    {
      patient: patientLocalId,
      status: 'active',
    },
    {
      enabled: canFetchClinical,
    }
  );

  // Map filter to API type
  const typeMapping = {
    'all': 'all',
    'progress_note': 'notes',
    'vitals': 'vitals',
    'medication': 'prescriptions',
    'lab_result': 'labs',
  };

  // Fetch timeline with infinite scroll
  // Uses id from URL params to start fetching immediately in parallel with patient data
  const {
    data: timelineData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isTimelineLoading,
    refetch: refetchTimeline,
  } = usePatientTimeline(id, {
    type: typeMapping[activeFilter] || 'all',
    search: debouncedSearch,
    pageSize: 20,
    enabled: canFetchClinical,
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
    // Labs are now filtered by API, no local filtering needed
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
      refetchContext(),
    ]);
  }, [refetch, refetchContext, id, invalidateTimeline]);

  // Slide-over handlers - using the centralized hook
  const handleAddNote = useCallback(() => slideOvers.open('note'), [slideOvers]);
  const handleRecordVitals = useCallback(() => slideOvers.open('vitals'), [slideOvers]);
  const handlePrescribe = useCallback(() => slideOvers.open('prescription'), [slideOvers]);
  const handleOrderLabs = useCallback(() => slideOvers.open('labs'), [slideOvers]);
  const handleRequestConsult = useCallback(() => slideOvers.open('referral'), [slideOvers]);
  const handleRecordFluids = useCallback(() => slideOvers.open('fluids'), [slideOvers]);

  // Close handler with data refresh
  const handleSlideOverClose = useCallback(() => {
    slideOvers.close();
    setCopyForwardData(null); // Clear copy forward data when closing
    setEditNoteData(null); // Clear edit note data when closing
  }, [slideOvers]);

  // Created handlers - refresh data and close
  const handleNoteCreated = useCallback(() => {
    refreshData();
    slideOvers.close();
    setCopyForwardData(null); // Clear copy forward data after note is created
    setEditNoteData(null); // Clear edit note data after note is created/updated
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
    setEditNoteData(null); // Clear any edit data
    slideOvers.open('note');
    toast.success("Note copied", {
      description: `${copyData.sectionsCopied?.length || 0} sections ready to edit`,
    });
  }, [slideOvers]);

  // Handle edit note from timeline - opens note editor in edit mode
  const handleEditNote = useCallback((editData) => {
    // editData contains: { noteId, template, templateId, templateTitle, data, title }
    if (!editData.template) {
      toast.error("Cannot edit note", { description: "Template information is missing" });
      return;
    }

    setEditNoteData({
      noteId: editData.noteId,
      template: editData.template,
      data: editData.data,
    });
    setCopyForwardData(null); // Clear any copy data
    slideOvers.open('note');
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

  // Chart handlers
  const handleAssignChart = useCallback(() => slideOvers.open('charts'), [slideOvers]);

  const handleChartAssigned = useCallback(() => {
    refetchCharts();
    slideOvers.close();
  }, [refetchCharts, slideOvers]);

  const handleRecordChartEntry = useCallback((assignment) => {
    setActiveChartAssignment(assignment);
    slideOvers.open('chartEntry');
  }, [slideOvers]);

  const handleChartEntryRecorded = useCallback(() => {
    refetchCharts();
    refreshData();
    slideOvers.close();
    setActiveChartAssignment(null);
  }, [refetchCharts, refreshData, slideOvers]);

  const handleChartSlideOverClose = useCallback(() => {
    slideOvers.close();
    setActiveChartAssignment(null);
  }, [slideOvers]);

  // Schedule Follow-up handler (navigate to appointments page)
  const handleScheduleFollowUp = useCallback(() => {
    navigate(`/appointments/create?patient=${id}`);
  }, [navigate, id]);

  // View Treatment Sheet handler (for admitted patients)
  const handleViewTreatmentSheet = useCallback(() => {
    // Get admission ID from active encounter or patient data
    const admissionId = activeEncounter?.admission_id ||
                        activeEncounter?.id || // Use encounter ID as fallback
                        patient?.local_data?.current_admission_id ||
                        patient?.current_admission_id;

    if (admissionId) {
      navigate(`/nursing/treatment-sheet?admission=${admissionId}`);
    } else {
      toast.error('No active admission found for this patient');
    }
  }, [navigate, activeEncounter, patient]);

  const userRole = user?.role || user?.user_type;
  const canRequestBreakGlass = ['admin', 'doctor', 'nurse'].includes(userRole);
  // Access denied if patient loaded but user lacks clinical access
  const accessDenied = patient && !isLoading && patient?.access?.clinical === false;
  const hasGateError = (contextError && contextError?.status !== 403) || (error && error?.status !== 403);
  const gateError = contextError && contextError?.status !== 403 ? contextError : error;

  const breakGlassMutation = useMutation({
    mutationFn: (payload) => patientsApi.requestBreakGlass(id, payload),
    onSuccess: (data) => {
      const expiresAt = data?.break_glass?.expires_at || null;
      setBreakGlassExpiresAt(expiresAt);
      setBreakGlassReason('');
      setBreakGlassOpen(false);

      const expiresLabel = expiresAt
        ? new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null;
      toast.success("Break-glass access granted", {
        description: expiresLabel ? `Access expires at ${expiresLabel}.` : "Access expires automatically.",
      });

      // Refetch patient to update access flags, then clinical data will load
      refetch();
      refetchContext();
      refetchTimeline();
      refetchEncounters();
    },
    onError: (err) => {
      toast.error("Break-glass request failed", {
        description: err?.message || "Please try again.",
      });
    },
  });

  const handleBreakGlassSubmit = useCallback(() => {
    if (!breakGlassReason.trim()) {
      return;
    }
    breakGlassMutation.mutate({
      reason: breakGlassReason.trim(),
      scope: 'clinical',
    });
  }, [breakGlassReason, breakGlassMutation]);

  // ============================================
  // Loading state
  // ============================================

  if (accessDenied) {
    const patientDetails = patient?.local_data || patient;
    const patientName = patientDetails?.user_details
      ? `${patientDetails.user_details.first_name || ''} ${patientDetails.user_details.last_name || ''}`.trim()
      : patientDetails?.name;
    const patientMrn = patientDetails?.medical_record_number || patientDetails?.mrn;

    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
          <div className="rounded-2xl border border-border/70 bg-card/70 p-8 shadow-sm chronicle-card-glow">
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-2">
                <span className="badge-chronicle-rose text-[10px] uppercase tracking-[0.2em]">
                  Access Restricted
                </span>
                {breakGlassExpiresAt && (
                  <span className="badge-chronicle-amber text-[10px]">
                    Break-glass active
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <h2 className="font-display text-2xl text-foreground">
                  Team-based access required
                </h2>
                <p className="text-sm text-muted-foreground">
                  This patient record is protected by team-based access controls.
                  Request break-glass only for urgent clinical need. All access is audited.
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Patient
                </p>
                <p className="text-sm text-foreground">
                  {patientName || "Unknown Patient"}
                </p>
                {patientMrn && (
                  <p className="text-xs text-muted-foreground">MRN {patientMrn}</p>
                )}
              </div>

              {canRequestBreakGlass ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => setBreakGlassOpen(true)}
                    className="bg-[oklch(0.65_0.22_15)] text-white hover:bg-[oklch(0.60_0.22_15)]"
                  >
                    Request Break-Glass Access
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Provide a reason to unlock this record for a limited time.
                  </span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Break-glass access is available to clinical staff only.
                </p>
              )}
            </div>
          </div>
        </div>

        <BreakGlassDialog
          open={isBreakGlassOpen}
          onOpenChange={setBreakGlassOpen}
          patientName={patientName}
          patientMrn={patientMrn}
          reason={breakGlassReason}
          onReasonChange={setBreakGlassReason}
          onSubmit={handleBreakGlassSubmit}
          isSubmitting={breakGlassMutation.isPending}
          ttlMinutes={30}
        />
      </div>
    );
  }

  if (isLoading || isContextLoading || authLoading) {
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

  if (hasGateError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-display text-foreground">
            Unable to load patient record
          </h2>
          <p className="text-muted-foreground">
            {gateError?.message || 'An error occurred while fetching patient data.'}
          </p>
          <Button onClick={() => {
            refetch();
            refetchContext();
          }}>
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
        onViewTreatmentSheet={handleViewTreatmentSheet}
        onRecordFluids={handleRecordFluids}
        onAssignChart={handleAssignChart}
        onManageInsurance={() => slideOvers.open('insurance')}
        insurance={patientInsurance}
        activeAdmission={activeEncounter && ['inpatient', 'admission', 'emergency', 'hospitalization'].includes(activeEncounter.encounter_type?.toLowerCase()) ? activeEncounter : null}
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
          {/* Active Charts Section - Show if patient has assigned charts */}
          {chartAssignments?.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-amber-600" />
                  <h3 className="font-mono text-sm font-medium text-foreground">
                    Active Charts
                  </h3>
                  <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {chartAssignments.length}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAssignChart}
                  className="font-mono text-xs"
                >
                  + Assign Chart
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {chartAssignments.slice(0, 6).map((assignment, index) => (
                  <ChartAssignmentCard
                    key={assignment.id}
                    assignment={assignment}
                    index={index}
                    onRecordEntry={handleRecordChartEntry}
                    compact
                  />
                ))}
              </div>
            </div>
          )}

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
                {/* Show encounter count hint when some encounters have no documentation */}
                {encounters?.length > 0 && encounters.length > groupedByEncounter.encounters.length && (
                  <span className="font-mono text-xs text-muted-foreground/70" title="Some encounters have no clinical documentation">
                    • {encounters.length} encounters ({groupedByEncounter.encounters.length} documented)
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
                          currentUserId={user?.id}
                          onCopyNote={handleCopyNote}
                          onEditNote={handleEditNote}
                          onNoteUpdated={refetchTimeline}
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
                        currentUserId={user?.id}
                        onCopyNote={handleCopyNote}
                        onEditNote={handleEditNote}
                        onNoteUpdated={refetchTimeline}
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
          initialTemplate={editNoteData?.template || copyForwardData?.template}
          initialData={editNoteData?.data || copyForwardData?.data}
          editNoteId={editNoteData?.noteId}
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

        {/* Fluid Balance Slide-Over */}
        <AddFluidBalanceSlideOver
          open={slideOvers.isOpen('fluids')}
          onClose={handleSlideOverClose}
          patient={patient}
          admission={
            // Use actual WardAdmission ID, not encounter ID
            // The admission prop expects a WardAdmission object with id
            patient?.local_data?.current_admission_id
              ? { id: patient.local_data.current_admission_id }
              : patient?.current_admission_id
                ? { id: patient.current_admission_id }
                : null
          }
          onFluidRecorded={refreshData}
        />

        {/* Chart Assignment Slide-Over */}
        <AddChartSlideOver
          open={slideOvers.isOpen('charts')}
          onClose={handleChartSlideOverClose}
          patient={patient}
          admission={
            patient?.local_data?.current_admission_id
              ? { id: patient.local_data.current_admission_id }
              : patient?.current_admission_id
                ? { id: patient.current_admission_id }
                : null
          }
          onChartAssigned={handleChartAssigned}
        />

        {/* Chart Entry Form Slide-Over */}
        <ChartEntryForm
          open={slideOvers.isOpen('chartEntry')}
          onClose={handleChartSlideOverClose}
          assignmentId={activeChartAssignment?.id}
          patient={patient}
          onEntryRecorded={handleChartEntryRecorded}
        />

        {/* Patient Insurance Slide-Over */}
        <PatientInsuranceSlideOver
          open={slideOvers.isOpen('insurance')}
          onClose={handleSlideOverClose}
          patient={patient}
        />
      </div>
    </div>
  );
};

export default PatientChroniclePage;
