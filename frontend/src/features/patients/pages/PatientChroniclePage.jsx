import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import TestTube from 'lucide-react/dist/esm/icons/test-tube.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { usePatient } from "@/features/patients/hooks/usePatientQueries";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePatientTimeline, flattenTimelinePages, getTimelineTotalCount, useInvalidateTimeline } from "@/hooks/useTimelineQueries";
import { usePatientEncounters } from "@/features/encounters/hooks/useEncounterQueries";
// useClinicalSummary removed - context endpoint now provides all sidebar data
import { useChronicleContext } from "@/hooks/useChronicleContext";
import { useMultipleSlideOvers } from "@/hooks/useSlideOver";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import PatientIdentityHero from "@/components/chronicle/PatientIdentityHero";
import ClinicalSummarySidebar from "@/components/chronicle/ClinicalSummarySidebar";
import TimelineEntry from "@/components/chronicle/TimelineEntry";
import BreakGlassDialog from "@/components/chronicle/BreakGlassDialog";
import { usePatientInsurance } from "@/features/billing/hooks";
import { patientsApi } from '@/features/patients/api';
import ChartAssignmentCard from "@/components/charts/ChartAssignmentCard";
import { useChartAssignments } from "@/features/charts/hooks";
import { DischargeCasePanel } from "@/features/discharge/components/DischargeCasePanel";
import ChronicleWorkspaceHost from "@/features/patients/components/ChronicleWorkspaceHost";
import {
  getInitialExpandedEncounterIds,
  getInitialExpandedNoteIds,
  normalizeExpansionId,
} from "@/components/chronicle/chronicleNoteUtils";
import {
  chronicleWorkspaceIds,
  prefetchChronicleWorkspaceResources,
} from "@/features/patients/chronicle/workspaceRegistry";
import {
  buildChronicleSearch,
  CHRONICLE_ALL_VISITS,
  CHRONICLE_VISIT_PARAM,
  resolveChronicleVisitScope,
  stripTransientChronicleParams,
} from "@/features/patients/chronicle/visitScopeUtils";
import { emitOnboardingEvent } from "@/features/onboarding";

import { useDebounce } from "@/hooks/use-debounce";
const DISCHARGE_CASE_ROLES = new Set([
  'admin',
  'doctor',
  'nurse',
  'head_nurse',
  'nurse_practitioner',
  'inpatient_doctor',
  'practitioner',
  'physician',
  'billing',
]);

function getEncounterKind(encounter) {
  const encounterType = encounter?.encounter_type || encounter?.type;
  return typeof encounterType === 'string' ? encounterType.toLowerCase() : 'outpatient';
}

function formatEncounterDateRange(encounter) {
  const start = encounter?.start_time
    ? new Date(encounter.start_time).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Unknown date';

  const end = encounter?.end_time
    ? new Date(encounter.end_time).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;

  return end && end !== start ? `${start} - ${end}` : start;
}

function formatEncounterScopeLabel(encounter, activeEncounterId) {
  if (!encounter) {
    return 'Select visit';
  }

  const encounterKind = getEncounterKind(encounter);
  const encounterTypeLabel = encounterKind === 'inpatient'
    ? 'Inpatient'
    : encounterKind === 'emergency'
      ? 'Emergency'
      : 'Outpatient';

  const details = [formatEncounterDateRange(encounter)];

  if (encounter?.practitioner_name) {
    details.push(encounter.practitioner_name);
  }

  if (encounter?.status) {
    details.push(encounter.status);
  }

  const prefix = String(encounter?.id) === String(activeEncounterId)
    ? 'Current'
    : encounterTypeLabel;

  return `${prefix} visit - ${details.join(' • ')}`;
}

/**
 * PatientChroniclePage - Magazine-style patient health record view
 *
 * Layout:
 * - Hero header with patient identity
 * - Two-column layout: Clinical Summary | Timeline Chronicle
 * - Timeline with filterable entries
 *
 * @param {string} defaultAction - Optional action to trigger on mount (e.g., 'ward_round')
 */
const PatientChroniclePage = ({ defaultAction }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const prefetchedActionsRef = useRef(new Set());
  const openedPatientChartsRef = useRef(new Set());
  const lastFilterEventRef = useRef(null);
  const encounterExpansionSeedRef = useRef(null);
  const noteExpansionSeedRef = useRef(null);
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [expandedEncounters, setExpandedEncounters] = useState(() => new Set());
  const [expandedNoteIds, setExpandedNoteIds] = useState(() => new Set());

  // Copy forward state - holds template and data for pre-filling note editor
  const [copyForwardData, setCopyForwardData] = useState(null);

  // Edit note state - holds note ID and data for editing existing notes
  const [editNoteData, setEditNoteData] = useState(null);
  const [requestedDischargeAdmissionId, setRequestedDischargeAdmissionId] = useState(null);

  const [isBreakGlassOpen, setBreakGlassOpen] = useState(false);
  const [breakGlassReason, setBreakGlassReason] = useState('');
  const [breakGlassExpiresAt, setBreakGlassExpiresAt] = useState(null);

  // Check for action query params (e.g., from referral inbox)
  const actionParam = searchParams.get('action');
  const referralIdParam = searchParams.get('referral_id');
  const admissionParam = searchParams.get('admission');
  const visitParam = searchParams.get(CHRONICLE_VISIT_PARAM);
  const clearQueryParams = useCallback(() => {
    const nextSearch = stripTransientChronicleParams(location.search);
    if (nextSearch !== location.search) {
      navigate({ pathname: location.pathname, search: nextSearch }, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  // Slide-over management - auto-collapses sidebar when any slide-over opens
  const slideOvers = useMultipleSlideOvers(chronicleWorkspaceIds);

  // Chart entry state - which assignment is being recorded
  const [activeChartAssignment, setActiveChartAssignment] = useState(null);
  const [selectedChartHistoryAssignmentId, setSelectedChartHistoryAssignmentId] = useState(null);

  // Fetch patient data (includes access flags for conditional fetching)
  const { data: patient, isLoading, error, refetch } = usePatient(id);

  // Check if user has clinical access (from patient endpoint response)
  const hasClinicalAccess = patient?.access?.clinical === true;
  const patientLocalId = patient?.local_data?.id || patient?.id || id;
  const patientIdentityId = patient?.local_data?.patient_identity_id || patient?.patient_identity_id || null;
  const prefetchWorkspaceForOpen = useCallback((workspaceId) => {
    prefetchChronicleWorkspaceResources(workspaceId, { patientLocalId, queryClient });
  }, [patientLocalId, queryClient]);

  // Auto-open slide-over based on action query param or defaultAction prop
  const wardRoundParam = searchParams.get('wardRound');
  const consultationParam = searchParams.get('consultation');
  const openChronicleWorkspace = useCallback((workspaceId) => {
    prefetchWorkspaceForOpen(workspaceId);
    slideOvers.open(workspaceId);
  }, [prefetchWorkspaceForOpen, slideOvers]);

  useEffect(() => {
    const action = actionParam || defaultAction;
    if (action === 'add_note') {
      openChronicleWorkspace('note');
      // Clear the query params after opening
      if (actionParam) clearQueryParams();
    } else if (action === 'ward_round' || wardRoundParam === 'true') {
      openChronicleWorkspace('wardRound');
      // Clear the query params after opening
      if (actionParam || wardRoundParam) clearQueryParams();
    } else if (action === 'consultation' || consultationParam === 'true') {
      openChronicleWorkspace('consultation');
      // Clear the query params after opening
      if (actionParam || consultationParam) clearQueryParams();
    } else if (action === 'discharge') {
      const admissionId = admissionParam
        || patient?.local_data?.current_admission_id
        || patient?.current_admission_id;

      if (!admissionId) {
        if (!patient && !admissionParam) {
          return;
        }
        toast.error('No active admission found for this patient');
        if (actionParam || admissionParam) clearQueryParams();
        return;
      }

      setRequestedDischargeAdmissionId(String(admissionId));
      openChronicleWorkspace('discharge');
      if (actionParam || admissionParam) clearQueryParams();
    } else if (action === 'add_prescription') {
      openChronicleWorkspace('prescription');
      if (actionParam) clearQueryParams();
    }
  }, [
    actionParam,
    defaultAction,
    wardRoundParam,
    consultationParam,
    admissionParam,
    patient,
    openChronicleWorkspace,
    clearQueryParams,
  ]);

  // Debounce search input
  const debouncedSearch = useDebounce(searchInput, 300);

  // Check if any slide-over is open (for timeline compression)
  const isAnySlideOverOpen = slideOvers.activeSlideOver !== null;
  const isCopilotSlideOverOpen = slideOvers.isOpen('copilot');

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

  const canFetchClinical = hasClinicalAccess;
  const canViewDischargeCase = DISCHARGE_CASE_ROLES.has(user?.user_type);

  // Fetch patient encounters for grouping
  const {
    data: encounters,
    isLoading: areEncountersLoading,
    refetch: refetchEncounters,
  } = usePatientEncounters(id, {
    enabled: canFetchClinical,
  });

  // Fetch patient insurance (only if user has clinical access)
  const { data: insuranceData } = usePatientInsurance(id, {}, {
    enabled: hasClinicalAccess,
  });
  const patientInsurance = insuranceData?.results || insuranceData || [];

  // Find the active encounter (in-progress inpatient admission takes priority)
  const activeEncounter = useMemo(() => {
    if (!encounters || encounters.length === 0) return null;
    const activeOutpatientVisitStatuses = new Set([
      'checked_in',
      'waiting',
      'called',
      'in_progress',
      'on_hold',
      'ready_checkout',
    ]);

    const activeInpatient = encounters.find((encounter) => (
      encounter.status === 'in-progress'
      && ['inpatient', 'admission', 'emergency', 'hospitalization'].includes(getEncounterKind(encounter))
    ));

    if (activeInpatient) {
      return activeInpatient;
    }

    const activeAny = encounters.find((encounter) => encounter.status === 'in-progress');
    if (activeAny) {
      return activeAny;
    }

    return encounters.find((encounter) => (
      getEncounterKind(encounter) === 'outpatient'
      && encounter.status === 'planned'
      && activeOutpatientVisitStatuses.has(encounter.outpatient_visit_status)
    )) || null;
  }, [encounters]);

  const resolvedVisitScope = useMemo(() => resolveChronicleVisitScope({
    requestedVisit: visitParam,
    activeEncounterId: chronicleContext?.active_encounter?.id || activeEncounter?.id,
    encounters,
    areEncountersLoading,
  }), [
    activeEncounter?.id,
    areEncountersLoading,
    chronicleContext?.active_encounter?.id,
    encounters,
    visitParam,
  ]);
  const isAllVisitsScope = resolvedVisitScope === CHRONICLE_ALL_VISITS;
  const selectedEncounterId = !resolvedVisitScope || isAllVisitsScope ? null : resolvedVisitScope;
  const isVisitScopePending = canFetchClinical && !resolvedVisitScope;
  const selectedEncounter = useMemo(
    () => encounters?.find((encounter) => String(encounter.id) === String(selectedEncounterId)) || null,
    [encounters, selectedEncounterId]
  );
  const visitScopeOptions = useMemo(() => {
    const options = [{
      value: CHRONICLE_ALL_VISITS,
      label: 'All history',
    }];

    if (!Array.isArray(encounters)) {
      return options;
    }

    return options.concat(
      encounters.map((encounter) => ({
        value: String(encounter.id),
        label: formatEncounterScopeLabel(encounter, activeEncounter?.id),
      }))
    );
  }, [activeEncounter?.id, encounters]);

  // Get patient ID for clinical queries - use URL id directly to enable parallel loading
  // The URL id is the patient UUID which works for all clinical endpoints
  const copilotPatientName = useMemo(() => {
    const details = patient?.local_data || patient;
    if (!details) return 'Patient';

    const userDetails = details.user_details;
    if (!userDetails) {
      return details.name || 'Patient';
    }

    const fullName = `${userDetails.first_name || ''} ${userDetails.last_name || ''}`.trim();
    return fullName || details.name || 'Patient';
  }, [patient]);

  useEffect(() => {
    if (!hasClinicalAccess || !patientLocalId) {
      return;
    }
    if (openedPatientChartsRef.current.has(patientLocalId)) {
      return;
    }
    openedPatientChartsRef.current.add(patientLocalId);
    emitOnboardingEvent('patients.chart_opened', {
      success: true,
      patient_id: patientLocalId,
    });
  }, [hasClinicalAccess, patientLocalId]);

  useEffect(() => {
    if (!patientLocalId) {
      return;
    }
    const token = `${patientLocalId}:${activeFilter}`;
    if (lastFilterEventRef.current === token) {
      return;
    }
    lastFilterEventRef.current = token;
    emitOnboardingEvent('chronicle.filter_changed', {
      filter: activeFilter,
      patient_id: patientLocalId,
    });
  }, [activeFilter, patientLocalId]);

  useEffect(() => {
    prefetchedActionsRef.current = new Set();
    setRequestedDischargeAdmissionId(null);
  }, [id]);

  // Use chronicle context data directly - no more legacy fallback needed
  const medications = chronicleContext?.active_medications || [];
  const parsedAllergies = chronicleContext?.allergies || [];
  const problems = chronicleContext?.active_problems || [];

  // Get latest vitals from context
  const latestVitals = chronicleContext?.latest_vitals;
  // Use primitive values for memoization to avoid object reference issues
  const vitalsId = latestVitals?.id;
  const vitalsRecordedAt = latestVitals?.recorded_at;

  // Transform latest_vitals from context into labResults format for sidebar
  const labResults = useMemo(() => {
    // Early return using the primitives we already checked
    if (!vitalsId || !latestVitals) return [];

    const results = [];
    const timestamp = vitalsRecordedAt;

    if (latestVitals.temperature) {
      const temp = parseFloat(latestVitals.temperature);
      results.push({
        id: `temp-${vitalsId}`,
        name: 'Temp',
        value: latestVitals.temperature,
        unit: '°C',
        timestamp,
        is_abnormal: temp > 38 || temp < 36,
        abnormal_direction: temp > 38 ? 'high' : 'low',
      });
    }

    if (latestVitals.heart_rate) {
      const hr = parseInt(latestVitals.heart_rate);
      results.push({
        id: `hr-${vitalsId}`,
        name: 'HR',
        value: latestVitals.heart_rate,
        unit: 'bpm',
        timestamp,
        is_abnormal: hr > 100 || hr < 60,
        abnormal_direction: hr > 100 ? 'high' : 'low',
      });
    }

    if (latestVitals.blood_pressure) {
      const parts = latestVitals.blood_pressure.split('/');
      const systolic = parts.length > 0 ? Number(parts[0]) : null;
      results.push({
        id: `bp-${vitalsId}`,
        name: 'BP',
        value: latestVitals.blood_pressure,
        unit: 'mmHg',
        timestamp,
        is_abnormal: systolic ? (systolic > 140 || systolic < 90) : false,
        abnormal_direction: systolic > 140 ? 'high' : 'low',
      });
    }

    if (latestVitals.oxygen_saturation) {
      const spo2 = parseInt(latestVitals.oxygen_saturation);
      results.push({
        id: `spo2-${vitalsId}`,
        name: 'SpO2',
        value: latestVitals.oxygen_saturation,
        unit: '%',
        timestamp,
        is_abnormal: spo2 < 95,
        abnormal_direction: 'low',
      });
    }

    if (latestVitals.respiratory_rate) {
      const rr = parseInt(latestVitals.respiratory_rate);
      results.push({
        id: `rr-${vitalsId}`,
        name: 'RR',
        value: latestVitals.respiratory_rate,
        unit: '/min',
        timestamp,
        is_abnormal: rr > 20 || rr < 12,
        abnormal_direction: rr > 20 ? 'high' : 'low',
      });
    }

    return results;
    // Use primitive vitalsId as dependency - will only re-run when vitals actually change
  }, [vitalsId, vitalsRecordedAt, latestVitals]);

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
    encounterId: selectedEncounterId || undefined,
    enabled: canFetchClinical && !!resolvedVisitScope,
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

  const dischargeCaseAdmissionId = useMemo(() => (
    requestedDischargeAdmissionId
    || patient?.local_data?.current_admission_id
    || patient?.current_admission_id
    || activeEncounter?.admission_id
    || null
  ), [
    activeEncounter?.admission_id,
    patient?.current_admission_id,
    patient?.local_data?.current_admission_id,
    requestedDischargeAdmissionId,
  ]);

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

  const expansionSeedKey = useMemo(() => (
    `${id}:${resolvedVisitScope || 'pending'}:${activeFilter}:${debouncedSearch.trim().toLowerCase()}`
  ), [activeFilter, debouncedSearch, id, resolvedVisitScope]);

  useEffect(() => {
    const hasEncounterGroups = groupedByEncounter.encounters.length > 0;
    const hasUnlinkedEntries = groupedByEncounter.unlinked.length > 0;

    if (hasEncounterGroups && areEncountersLoading) {
      return;
    }
    if (!hasEncounterGroups && !hasUnlinkedEntries) {
      return;
    }
    if (encounterExpansionSeedRef.current === expansionSeedKey) {
      return;
    }

    setExpandedEncounters(getInitialExpandedEncounterIds({
      encounters: groupedByEncounter.encounters,
      unlinkedEntries: groupedByEncounter.unlinked,
      activeEncounterId: activeEncounter?.id,
    }));
    encounterExpansionSeedRef.current = expansionSeedKey;
  }, [
    activeEncounter?.id,
    areEncountersLoading,
    expansionSeedKey,
    groupedByEncounter.encounters,
    groupedByEncounter.unlinked,
  ]);

  useEffect(() => {
    if (filteredEntries.length === 0) {
      return;
    }
    if (noteExpansionSeedRef.current === expansionSeedKey) {
      return;
    }

    setExpandedNoteIds(getInitialExpandedNoteIds({
      entries: filteredEntries,
      activeFilter,
    }));
    noteExpansionSeedRef.current = expansionSeedKey;
  }, [activeFilter, expansionSeedKey, filteredEntries]);

  // Toggle encounter expansion
  const toggleEncounter = useCallback((encounterId) => {
    const normalizedEncounterId = normalizeExpansionId(encounterId);
    if (!normalizedEncounterId) {
      return;
    }

    setExpandedEncounters(prev => {
      const next = new Set(prev);
      if (next.has(normalizedEncounterId)) {
        next.delete(normalizedEncounterId);
      } else {
        next.add(normalizedEncounterId);
      }
      return next;
    });
  }, []);

  const toggleNoteExpanded = useCallback((noteId) => {
    const normalizedNoteId = normalizeExpansionId(noteId);
    if (!normalizedNoteId) {
      return;
    }

    setExpandedNoteIds((previous) => {
      const next = new Set(previous);
      if (next.has(normalizedNoteId)) {
        next.delete(normalizedNoteId);
      } else {
        next.add(normalizedNoteId);
      }
      return next;
    });
  }, []);

  // Expand all encounters
  const expandAll = useCallback(() => {
    const allIds = new Set();
    if (groupedByEncounter.unlinked.length > 0) {
      allIds.add('unlinked');
    }
    groupedByEncounter.encounters.forEach((group) => {
      const normalizedEncounterId = normalizeExpansionId(group.encounter?.id);
      if (normalizedEncounterId) {
        allIds.add(normalizedEncounterId);
      }
    });
    setExpandedEncounters(allIds);
  }, [groupedByEncounter]);

  // Collapse all encounters
  const collapseAll = useCallback(() => {
    setExpandedEncounters(new Set());
  }, []);

  // Get total count for display
  const totalCount = useMemo(() => getTimelineTotalCount(timelineData), [timelineData]);

  useEffect(() => {
    if (!visitParam || !resolvedVisitScope || visitParam === resolvedVisitScope) {
      return;
    }

    const nextSearch = buildChronicleSearch(location.search, {
      updates: {
        [CHRONICLE_VISIT_PARAM]: resolvedVisitScope,
      },
    });

    navigate({ pathname: location.pathname, search: nextSearch }, { replace: true });
  }, [location.pathname, location.search, navigate, resolvedVisitScope, visitParam]);

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

  const prefetchActionResources = useCallback((action) => {
    if (!action) return;

    const actionToken = `${action}:${patientLocalId || 'none'}`;
    if (prefetchedActionsRef.current.has(actionToken)) {
      return;
    }
    prefetchedActionsRef.current.add(actionToken);
    prefetchChronicleWorkspaceResources(action, { patientLocalId, queryClient });
  }, [patientLocalId, queryClient]);

  // Slide-over handlers - using the centralized hook
  const handleAskChronicle = useCallback(() => {
    openChronicleWorkspace('copilot');
  }, [openChronicleWorkspace]);
  const handleAddNote = useCallback(() => {
    openChronicleWorkspace('note');
  }, [openChronicleWorkspace]);
  const handleRecordVitals = useCallback(() => {
    openChronicleWorkspace('vitals');
  }, [openChronicleWorkspace]);
  const handlePrescribe = useCallback(() => {
    openChronicleWorkspace('prescription');
  }, [openChronicleWorkspace]);
  const handleOrderLabs = useCallback(() => {
    openChronicleWorkspace('labs');
  }, [openChronicleWorkspace]);
  const handleRequestConsult = useCallback(() => {
    openChronicleWorkspace('referral');
  }, [openChronicleWorkspace]);
  const handleShareRecord = useCallback(() => {
    openChronicleWorkspace('crossFacility');
  }, [openChronicleWorkspace]);
  const handleReceiveRecord = useCallback(() => {
    openChronicleWorkspace('receiveRecord');
  }, [openChronicleWorkspace]);
  const handleRecordFluids = useCallback(() => {
    openChronicleWorkspace('fluids');
  }, [openChronicleWorkspace]);
  const handleStartWardRound = useCallback(() => {
    openChronicleWorkspace('wardRound');
  }, [openChronicleWorkspace]);
  const handleStartDischarge = useCallback(() => {
    const admissionId = patient?.local_data?.current_admission_id
      || patient?.current_admission_id
      || activeEncounter?.admission_id;

    if (!admissionId) {
      toast.error('No active admission found for this patient');
      return;
    }

    setRequestedDischargeAdmissionId(String(admissionId));
    openChronicleWorkspace('discharge');
  }, [patient, activeEncounter, openChronicleWorkspace]);

  // Close handler with data refresh
  const handleSlideOverClose = useCallback(() => {
    slideOvers.close();
    setCopyForwardData(null); // Clear copy forward data when closing
    setEditNoteData(null); // Clear edit note data when closing
    setRequestedDischargeAdmissionId(null);
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
    openChronicleWorkspace('note');
    toast.success("Note copied", {
      description: `${copyData.sectionsCopied?.length || 0} sections ready to edit`,
    });
  }, [openChronicleWorkspace]);

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
    openChronicleWorkspace('note');
  }, [openChronicleWorkspace]);

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

  const handleWardRoundCompleted = useCallback(() => {
    refreshData();
    slideOvers.close();
  }, [refreshData, slideOvers]);

  const handleDischargeCompleted = useCallback(() => {
    refreshData();
    slideOvers.close();
    setRequestedDischargeAdmissionId(null);
  }, [refreshData, slideOvers]);

  const handleViewMedicationHistory = useCallback(() => {
    openChronicleWorkspace('medicationHistory');
  }, [openChronicleWorkspace]);

  // Chart handlers
  const handleAssignChart = useCallback(() => {
    openChronicleWorkspace('charts');
  }, [openChronicleWorkspace]);

  const handleChartAssigned = useCallback(() => {
    refetchCharts();
    slideOvers.close();
  }, [refetchCharts, slideOvers]);

  const handleRecordChartEntry = useCallback((assignment) => {
    setActiveChartAssignment(assignment);
    openChronicleWorkspace('chartEntry');
  }, [openChronicleWorkspace]);

  const handleViewChartHistory = useCallback((assignment = null) => {
    setSelectedChartHistoryAssignmentId(assignment?.id || null);
    openChronicleWorkspace('chartHistory');
  }, [openChronicleWorkspace]);

  const handleChartEntryRecorded = useCallback(() => {
    refetchCharts();
    refreshData();
    slideOvers.close();
    setActiveChartAssignment(null);
  }, [refetchCharts, refreshData, slideOvers]);

  const handleChartSlideOverClose = useCallback(() => {
    slideOvers.close();
    setActiveChartAssignment(null);
    setSelectedChartHistoryAssignmentId(null);
  }, [slideOvers]);

  const handleManageInsurance = useCallback(() => {
    openChronicleWorkspace('insurance');
  }, [openChronicleWorkspace]);

  const handleVisitScopeChange = useCallback((nextVisitScope) => {
    const nextSearch = buildChronicleSearch(location.search, {
      updates: {
        [CHRONICLE_VISIT_PARAM]: nextVisitScope,
      },
    });

    navigate({ pathname: location.pathname, search: nextSearch }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const handleViewAllHistory = useCallback(() => {
    handleVisitScopeChange(CHRONICLE_ALL_VISITS);
  }, [handleVisitScopeChange]);

  const handleViewCurrentVisit = useCallback(() => {
    if (!activeEncounter?.id) {
      return;
    }

    handleVisitScopeChange(String(activeEncounter.id));
  }, [activeEncounter?.id, handleVisitScopeChange]);

  const handleConsultationCompleted = useCallback(() => {
    refetchTimeline?.();
    refetchContext?.();
  }, [refetchTimeline, refetchContext]);

  const workspaceContext = useMemo(() => ({
    patientId: id,
    patient,
    activeEncounter,
    patientIdentityId,
    referralId: referralIdParam,
    copilotPatientName,
    copyForwardData,
    editNoteData,
    activeChartAssignment,
    selectedChartHistoryAssignmentId,
    requestedDischargeAdmissionId,
    onClose: handleSlideOverClose,
    onChartWorkspaceClose: handleChartSlideOverClose,
    onNoteCreated: handleNoteCreated,
    onVitalsRecorded: handleVitalsRecorded,
    onPrescriptionCreated: handlePrescriptionCreated,
    onLabOrderCreated: handleLabOrderCreated,
    onReferralCreated: handleReferralCreated,
    onFluidRecorded: refreshData,
    onChartAssigned: handleChartAssigned,
    onChartEntryRecorded: handleChartEntryRecorded,
    onWardRoundCompleted: handleWardRoundCompleted,
    onConsultationCompleted: handleConsultationCompleted,
    onDischargeCompleted: handleDischargeCompleted,
  }), [
    id,
    patient,
    activeEncounter,
    patientIdentityId,
    referralIdParam,
    copilotPatientName,
    copyForwardData,
    editNoteData,
    activeChartAssignment,
    selectedChartHistoryAssignmentId,
    requestedDischargeAdmissionId,
    handleSlideOverClose,
    handleChartSlideOverClose,
    handleNoteCreated,
    handleVitalsRecorded,
    handlePrescriptionCreated,
    handleLabOrderCreated,
    handleReferralCreated,
    refreshData,
    handleChartAssigned,
    handleChartEntryRecorded,
    handleWardRoundCompleted,
    handleConsultationCompleted,
    handleDischargeCompleted,
  ]);

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
        onActionIntent={prefetchActionResources}
        onAskChronicle={handleAskChronicle}
        onAddNote={handleAddNote}
        onRecordVitals={handleRecordVitals}
        onPrescribe={handlePrescribe}
        onOrderLabs={handleOrderLabs}
        onRequestConsult={handleRequestConsult}
        onShareRecord={handleShareRecord}
        onReceiveRecord={handleReceiveRecord}
        onScheduleFollowUp={handleScheduleFollowUp}
        onViewTreatmentSheet={handleViewTreatmentSheet}
        onViewMedicationHistory={handleViewMedicationHistory}
        onRecordFluids={handleRecordFluids}
        onAssignChart={handleAssignChart}
        onViewChartHistory={handleViewChartHistory}
        onStartWardRound={handleStartWardRound}
        onStartDischarge={handleStartDischarge}
        onManageInsurance={handleManageInsurance}
        insurance={patientInsurance}
        activeAdmission={activeEncounter && ['inpatient', 'admission', 'emergency', 'hospitalization'].includes(activeEncounter.encounter_type?.toLowerCase()) ? activeEncounter : null}
      />

      {canViewDischargeCase && dischargeCaseAdmissionId && (
        <div className="px-6 pt-6">
          <DischargeCasePanel
            admissionId={dischargeCaseAdmissionId}
            title="Discharge Clearance"
          />
        </div>
      )}

      {/* Main Content: Sidebar + Timeline */}
      <div className={cn(
        "flex transition-all duration-300",
        isCopilotSlideOverOpen
          ? "lg:mr-[34rem]"
          : isAnySlideOverOpen && "lg:mr-[50%]"
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
          <div className="min-w-0">
            {/* Active Charts Section - Show if patient has assigned charts */}
            {chartAssignments?.length > 0 && (
              <div className="mb-6">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-amber-600" />
                    <h3 className="font-mono text-sm font-medium text-foreground">
                      Active Charts
                    </h3>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
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
                      onViewDetails={handleViewChartHistory}
                      compact
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Timeline Header with Search and Filters */}
            <div className="mb-6 space-y-4">
              {/* Title and count */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <h2 className="font-display text-2xl text-foreground">
                    Clinical Chronicle
                  </h2>
                  {totalCount > 0 && (
                    <span className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                      {totalCount} {totalCount === 1 ? 'entry' : 'entries'}
                    </span>
                  )}
                  {selectedEncounter && !isAllVisitsScope && (
                    <span className="font-mono text-xs text-muted-foreground/80">
                      Focused on {formatEncounterScopeLabel(selectedEncounter, activeEncounter?.id)}
                    </span>
                  )}
                  {/* Show encounter count hint when some encounters have no documentation */}
                  {isAllVisitsScope && encounters?.length > 0 && encounters.length > groupedByEncounter.encounters.length && (
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

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Visit focus
                  </span>
                </div>
                <Select
                  value={resolvedVisitScope || CHRONICLE_ALL_VISITS}
                  onValueChange={handleVisitScopeChange}
                >
                  <SelectTrigger className="min-w-[260px] max-w-[420px] font-mono text-xs">
                    <SelectValue placeholder="Select visit" />
                  </SelectTrigger>
                  <SelectContent className="z-[200]">
                    {visitScopeOptions.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className="font-mono text-xs"
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!isAllVisitsScope && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleViewAllHistory}
                    className="h-8 px-2 font-mono text-xs"
                  >
                    All history
                  </Button>
                )}
                {activeEncounter?.id && selectedEncounterId !== String(activeEncounter.id) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleViewCurrentVisit}
                    className="h-8 px-2 font-mono text-xs"
                  >
                    Current visit
                  </Button>
                )}
              </div>

              {/* Search and Filter row */}
              <div className="flex flex-wrap items-center gap-4">
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
                  <div className="flex rounded-lg bg-muted p-1" data-onboarding="chronicle-filter-group">
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
                        data-onboarding={
                          filter.key === 'all'
                            ? 'chronicle-filter-all'
                            : filter.key === 'progress_note'
                              ? 'chronicle-filter-notes'
                              : undefined
                        }
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
                {isAllVisitsScope && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={expandAll}
                      className="h-8 px-2 font-mono text-xs"
                    >
                      Expand visits
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={collapseAll}
                      className="h-8 px-2 font-mono text-xs"
                    >
                      Collapse visits
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Timeline Entries Grouped by Encounter */}
            <div className="relative space-y-4">
              {/* Loading state for initial load */}
              {(isTimelineLoading || isVisitScopePending) && filteredEntries.length === 0 && (
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
                const normalizedEncounterId = normalizeExpansionId(encounter.id);
                const isExpanded = normalizedEncounterId
                  ? expandedEncounters.has(normalizedEncounterId)
                  : false;
                const dateRange = formatEncounterDateRange(encounter);
                const encounterKind = getEncounterKind(encounter);
                const typeIcon = encounterKind === 'inpatient' ? Building2 : Calendar;
                const TypeIcon = typeIcon;

                return (
                  <div key={encounter.id} className="overflow-hidden rounded-lg border border-border bg-card">
                    {/* Encounter Header */}
                    <button
                      onClick={() => toggleEncounter(normalizedEncounterId)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      )}

                      <div className={cn(
                        "rounded-lg p-2",
                        encounterKind === 'inpatient' ? "bg-blue-500/10" : "bg-amber-500/10"
                      )}>
                        <TypeIcon className={cn(
                          "h-4 w-4",
                          encounterKind === 'inpatient' ? "text-blue-500" : "text-amber-500"
                        )} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium capitalize">
                            {encounter.encounter_type === 'inpatient' ? 'Inpatient Admission' :
                             encounter.encounter_type === 'emergency' ? 'Emergency Visit' : 'Outpatient Visit'}
                          </span>
                          <span className={cn(
                            "rounded-full px-2 py-0.5 font-mono text-xs",
                            encounter.status === 'finished' && "bg-muted text-muted-foreground",
                            encounter.status === 'in-progress' && "bg-green-500/10 text-green-600",
                            encounter.status === 'cancelled' && "bg-red-500/10 text-red-600"
                          )}>
                            {encounter.status}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
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

                      <div className="flex items-center gap-2">
                        <div className="hidden xl:flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 font-mono text-[10px]"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleViewMedicationHistory();
                            }}
                          >
                            <Pill className="h-3.5 w-3.5 mr-1" />
                            Meds
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 font-mono text-[10px]"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleViewChartHistory();
                            }}
                          >
                            <ClipboardList className="h-3.5 w-3.5 mr-1" />
                            Charts
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 font-mono text-[10px]"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleRecordFluids();
                            }}
                          >
                            <Droplets className="h-3.5 w-3.5 mr-1" />
                            Fluids
                          </Button>
                        </div>

                        <span className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                        </span>
                      </div>
                    </button>

                    {/* Encounter Entries */}
                    {isExpanded && (
                      <div className="space-y-3 border-t border-border px-4 py-3">
                        {entries.map((entry, index) => (
                          <TimelineEntry
                            key={entry.id}
                            entry={entry}
                            index={index}
                            currentUserId={user?.id}
                            isNoteExpanded={entry.id !== null && entry.id !== undefined
                              ? expandedNoteIds.has(String(entry.id))
                              : false}
                            onToggleNoteExpanded={toggleNoteExpanded}
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
                <div className="overflow-hidden rounded-lg border border-dashed border-border bg-card/50">
                  {/* Unlinked Header */}
                  <button
                    onClick={() => toggleEncounter('unlinked')}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                  >
                    {expandedEncounters.has('unlinked') ? (
                      <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    )}

                    <div className="rounded-lg bg-muted p-2">
                      <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-muted-foreground">
                          Unlinked Entries
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Legacy data without encounter context
                      </div>
                    </div>

                    <span className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                      {groupedByEncounter.unlinked.length} {groupedByEncounter.unlinked.length === 1 ? 'entry' : 'entries'}
                    </span>
                  </button>

                  {/* Unlinked Entries List */}
                  {expandedEncounters.has('unlinked') && (
                    <div className="space-y-3 border-t border-dashed border-border px-4 py-3">
                      {groupedByEncounter.unlinked.map((entry, index) => (
                        <TimelineEntry
                          key={entry.id}
                          entry={entry}
                          index={index}
                          currentUserId={user?.id}
                          isNoteExpanded={entry.id !== null && entry.id !== undefined
                            ? expandedNoteIds.has(String(entry.id))
                            : false}
                          onToggleNoteExpanded={toggleNoteExpanded}
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
                <div className="py-12 text-center text-muted-foreground">
                  <p className="font-mono text-sm">
                    {searchInput
                      ? 'No entries match your search'
                      : selectedEncounterId
                        ? 'No chronicle entries for this visit yet'
                        : 'No entries found'}
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
                  {!searchInput && selectedEncounterId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleViewAllHistory}
                      className="mt-2 font-mono text-xs"
                    >
                      View all history
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
                <div className="py-8 text-center text-muted-foreground">
                  <div className="mx-auto mb-2 h-px w-12 bg-border" />
                  <p className="font-mono text-xs">End of timeline</p>
                </div>
              )}
            </div>
          </div>
        </main>

        <ChronicleWorkspaceHost
          activeWorkspace={slideOvers.activeSlideOver}
          workspaceContext={workspaceContext}
        />
      </div>
    </div>
  );
};

export default PatientChroniclePage;
