/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
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
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import { lazy, Suspense, useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  patientKeys,
  usePatient,
  usePatientChronicleStartup,
  usePatientChronicleTimeline,
} from "@/features/patients/hooks/usePatientQueries";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { timelineKeys, usePatientTimeline, flattenTimelinePages, getTimelineTotalCount, useInvalidateTimeline } from "@/hooks/useTimelineQueries";
import { encounterKeys, usePatientEncounters } from "@/features/encounters/hooks/useEncounterQueries";
// useClinicalSummary removed - context endpoint now provides all sidebar data
import { useChronicleContext } from "@/hooks/useChronicleContext";
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
import { DischargeCasePanel } from "@/features/discharge/components/DischargeCasePanel";
import ChronicleWorkspaceHost from "@/features/patients/components/ChronicleWorkspaceHost";
import { ProblemListSidebar } from "@/features/problems";
import {
  getInitialExpandedEncounterIds,
  getInitialExpandedNoteIds,
  normalizeExpansionId,
} from "@/components/chronicle/chronicleNoteUtils";
import { useChronicleWorkspaceRouting } from "@/features/patients/chronicle/useChronicleWorkspaceRouting";
import {
  buildChronicleSearch,
  CHRONICLE_ALL_VISITS,
  CHRONICLE_VISIT_PARAM,
  resolveChronicleVisitScope,
} from "@/features/patients/chronicle/visitScopeUtils";
import { emitOnboardingEvent } from "@/features/onboarding";
import { usePageMeta } from "@/shared/hooks/usePageMeta";
import { resolvePatientDisplayName } from "@/features/patients/utils/resolvePatientDisplayName";
import { useSystemCapabilities } from "@/hooks/useSystemQueries";
import { isRustV2ApiMode } from "@/lib/api/v2/runtime";

import { useDebounce } from "@/hooks/use-debounce";

const WardRoundMode = lazy(() => import('@/features/patients/chronicle/ward-round/WardRoundMode'))
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

const CHRONICLE_TYPE_MAPPING = {
  all: 'all',
  progress_note: 'notes',
  vitals: 'vitals',
  medication: 'prescriptions',
  lab_result: 'labs',
};

const CHRONICLE_FILTER_OPTIONS = [
  { key: 'all', label: 'All', icon: null, onboardingId: 'chronicle-filter-all' },
  { key: 'progress_note', label: 'Notes', icon: FileText, onboardingId: 'chronicle-filter-notes' },
  { key: 'vitals', label: 'Vitals', icon: Activity },
  { key: 'medication', label: 'Meds', icon: Pill },
  { key: 'lab_result', label: 'Labs', icon: TestTube },
];

const VITAL_SIDEBAR_FIELDS = [
  {
    keys: ['temperature'],
    name: 'Temp',
    unit: '°C',
    abnormal: (value) => {
      const temp = Number.parseFloat(value);
      if (!Number.isFinite(temp)) return null;
      if (temp > 38) return 'high';
      if (temp < 36) return 'low';
      return null;
    },
  },
  {
    keys: ['heart_rate', 'pulse'],
    name: 'HR',
    unit: 'bpm',
    abnormal: (value) => {
      const heartRate = Number.parseInt(value, 10);
      if (!Number.isFinite(heartRate)) return null;
      if (heartRate > 100) return 'high';
      if (heartRate < 60) return 'low';
      return null;
    },
  },
  {
    keys: ['blood_pressure'],
    name: 'BP',
    unit: 'mmHg',
    abnormal: (value, vitals) => {
      const parts = String(value || '').split('/');
      const systolic = Number.parseInt(vitals?.blood_pressure_systolic ?? parts[0], 10);
      const diastolic = Number.parseInt(vitals?.blood_pressure_diastolic ?? parts[1], 10);
      if (Number.isFinite(systolic) && (systolic > 140 || systolic < 90)) {
        return systolic > 140 ? 'high' : 'low';
      }
      if (Number.isFinite(diastolic) && (diastolic > 90 || diastolic < 60)) {
        return diastolic > 90 ? 'high' : 'low';
      }
      return null;
    },
  },
  {
    keys: ['oxygen_saturation', 'spo2'],
    name: 'SpO2',
    unit: '%',
    abnormal: (value) => {
      const spo2 = Number.parseInt(value, 10);
      if (!Number.isFinite(spo2)) return null;
      return spo2 < 95 ? 'low' : null;
    },
  },
  {
    keys: ['respiratory_rate'],
    name: 'RR',
    unit: '/min',
    abnormal: (value) => {
      const respiratoryRate = Number.parseInt(value, 10);
      if (!Number.isFinite(respiratoryRate)) return null;
      if (respiratoryRate > 20) return 'high';
      if (respiratoryRate < 12) return 'low';
      return null;
    },
  },
  {
    keys: ['pain_level', 'pain_score'],
    name: 'Pain',
    unit: '/10',
    abnormal: (value) => {
      const pain = Number.parseInt(value, 10);
      if (!Number.isFinite(pain)) return null;
      return pain >= 7 ? 'high' : null;
    },
  },
];

function hasDisplayValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function firstDisplayValue(source, keys) {
  for (const key of keys) {
    if (hasDisplayValue(source?.[key])) {
      return source[key];
    }
  }
  return null;
}

function normalizeLatestVitalsForSidebar(latestVitals) {
  if (!latestVitals) {
    return [];
  }

  const timestamp = latestVitals.recorded_at
    || latestVitals.measured_at
    || latestVitals.timestamp
    || latestVitals.created_at
    || null;

  return VITAL_SIDEBAR_FIELDS.flatMap((field) => {
    const value = firstDisplayValue(latestVitals, field.keys);
    if (!hasDisplayValue(value)) {
      return [];
    }

    const abnormalDirection = field.abnormal?.(value, latestVitals) || null;
    return [{
      id: `${field.name}-${latestVitals.id || timestamp || value}`,
      name: field.name,
      value,
      unit: field.unit,
      timestamp,
      is_abnormal: Boolean(abnormalDirection),
      abnormal_direction: abnormalDirection,
    }];
  });
}

function normalizeLabResultsForSidebar(results) {
  if (!Array.isArray(results)) {
    return [];
  }

  return results.reduce((normalizedResults, result) => {
    const normalizedResult = {
      id: result.id,
      name: result.name || result.test_name || result.title || result.order_number || 'Lab result',
      value: result.value ?? result.result_value ?? result.status_display ?? result.status ?? null,
      unit: result.unit || result.result_unit || null,
      timestamp: result.timestamp || result.entered_at || result.completed_at || result.ordered_at || result.created_at || null,
      is_abnormal: result.is_abnormal === true || ['low', 'high', 'abnormal', 'critical_low', 'critical_high'].includes(result.flag),
      abnormal_direction: result.abnormal_direction || result.flag || null,
    };
    if (hasDisplayValue(normalizedResult.name) || hasDisplayValue(normalizedResult.value)) {
      normalizedResults.push(normalizedResult);
    }
    return normalizedResults;
  }, []);
}

function hasSeedableTimelinePage(page) {
  return Array.isArray(page?.results) && page.results.length > 0;
}

function hasTimelinePageResults(data) {
  return Array.isArray(data?.pages) && data.pages.some(hasSeedableTimelinePage);
}

function buildTimelineDataFromInitialPage(page) {
  if (!hasSeedableTimelinePage(page)) {
    return null;
  }

  return {
    pages: [page],
    pageParams: [null],
  };
}

function getEncounterKind(encounter) {
  const encounterType = encounter?.encounter_type || encounter?.type;
  return typeof encounterType === 'string' ? encounterType.toLowerCase() : null;
}

function getEntryTimestamp(entry) {
  return entry?.timestamp
    || entry?.occurred_at
    || entry?.recorded_at
    || entry?.measured_at
    || entry?.created_at
    || entry?.updated_at
    || entry?.data?.timestamp
    || entry?.data?.recorded_at
    || entry?.data?.measured_at
    || entry?.data?.created_at
    || entry?.data?.updated_at
    || null;
}

function toTimestampMs(value) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sortEntriesByTimestampDesc(entries = []) {
  return entries.toSorted((a, b) => {
    const timestampA = toTimestampMs(getEntryTimestamp(a)) || 0;
    const timestampB = toTimestampMs(getEntryTimestamp(b)) || 0;
    return timestampB - timestampA;
  });
}

function firstValidTimestamp(...values) {
  return values.find((value) => toTimestampMs(value) !== null) || null;
}

function getEncounterDisplayStart(encounter, fallbackTimestamp = null) {
  return firstValidTimestamp(
    encounter?.start_time,
    encounter?.started_at,
    encounter?.date,
    encounter?.created_at,
    fallbackTimestamp,
  );
}

function getEncounterDisplayEnd(encounter) {
  return firstValidTimestamp(encounter?.end_time, encounter?.ended_at);
}

function formatEncounterDateRange(encounter, fallbackTimestamp = null) {
  const startTimestamp = getEncounterDisplayStart(encounter, fallbackTimestamp);
  const endTimestamp = getEncounterDisplayEnd(encounter);
  const start = startTimestamp
    ? new Date(startTimestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Unknown date';

  const end = endTimestamp
    ? new Date(endTimestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;

  return end && end !== start ? `${start} - ${end}` : start;
}

function getEncounterTitle(encounter) {
  const encounterKind = getEncounterKind(encounter);

  if (encounterKind === 'inpatient' || encounterKind === 'admission' || encounterKind === 'hospitalization') {
    return 'Inpatient Admission';
  }
  if (encounterKind === 'emergency') {
    return 'Emergency Visit';
  }
  if (encounterKind === 'outpatient') {
    return 'Outpatient Visit';
  }

  return 'Documented Visit';
}

function formatEncounterScopeLabel(encounter, activeEncounterId) {
  if (!encounter) {
    return 'Select visit';
  }

  const encounterKind = getEncounterKind(encounter);
  const encounterTypeLabel = encounterKind === 'inpatient' || encounterKind === 'admission' || encounterKind === 'hospitalization'
    ? 'Inpatient'
    : encounterKind === 'emergency'
      ? 'Emergency'
      : encounterKind === 'outpatient'
        ? 'Outpatient'
        : 'Documented';

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

function isNoteTimelineEntry(entry) {
  const type = entry?.type || entry?.entry_type;
  return [
    'progress_note',
    'soap_note',
    'admission_note',
    'discharge_note',
    'consult_note',
    'consultation_note',
    'nursing_note',
    'note',
  ].includes(type);
}

function getTimelineEntryTitle(entry) {
  return entry?.title
    || entry?.summary
    || entry?.data?.title
    || entry?.data?.note_type
    || entry?.data?.template_title
    || entry?.type
    || entry?.entry_type
    || 'Clinical entry';
}

function compactMedicationDetail(medication) {
  return [
    medication?.dosage || medication?.dose,
    medication?.route || medication?.route_display,
    medication?.frequency || medication?.frequency_display,
  ].filter(hasDisplayValue).join(' • ');
}

function compactLabDetail(lab) {
  return [
    hasDisplayValue(lab?.value) ? `${lab.value}${lab?.unit ? ` ${lab.unit}` : ''}` : null,
    lab?.timestamp
      ? new Date(lab.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : null,
  ].filter(hasDisplayValue).join(' • ');
}

function useChronicleTimelineViewModel({
  activeEncounter,
  activeFilter,
  chartContextEncounter,
  encounters,
  isAllVisitsScope,
  labResults,
  medications,
  patientName,
  recentVitals,
  timelineDisplayData,
}) {
  const timelineEntries = useMemo(() => {
    if (!timelineDisplayData) return [];

    const flatEntries = flattenTimelinePages(timelineDisplayData);

    return flatEntries.map(entry => {
      let displayType = entry.type;
      const normalizedTimestamp = getEntryTimestamp(entry);

      if (entry.entry_type === 'prescription') {
        displayType = 'medication';
      }

      if (entry.entry_type === 'vitals' && entry.data) {
        return {
          ...entry,
          type: 'vitals',
          timestamp: normalizedTimestamp,
          data: {
            temperature: entry.data.temperature,
            blood_pressure: entry.data.blood_pressure,
            heart_rate: entry.data.heart_rate,
            spo2: entry.data.spo2 || entry.data.oxygen_saturation,
            oxygen_saturation: entry.data.oxygen_saturation || entry.data.spo2,
            respiratory_rate: entry.data.respiratory_rate,
            pain_level: entry.data.pain_level,
          }
        };
      }

      if (entry.entry_type === 'prescription' && entry.data) {
        return {
          ...entry,
          type: 'medication',
          timestamp: normalizedTimestamp,
          data: {
            ...entry.data,
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
        timestamp: normalizedTimestamp,
      };
    });
  }, [timelineDisplayData]);

  const filteredEntries = useMemo(() => {
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
    return timelineEntries;
  }, [timelineEntries, activeFilter]);

  const groupedByEncounter = useMemo(() => {
    const encounterMap = new Map();
    if (encounters) {
      encounters.forEach(enc => {
        if (enc?.id !== null && enc?.id !== undefined) {
          encounterMap.set(String(enc.id), enc);
        }
      });
    }

    const groups = {
      encounters: [],
      unlinked: []
    };

    const encounterEntries = new Map();

    filteredEntries.forEach(entry => {
      const encounterId = normalizeExpansionId(
        entry.encounter_id
          || entry.encounter?.id
          || entry.data?.encounter_id
          || entry.data?.encounter?.id
      );

      if (encounterId) {
        if (!encounterEntries.has(encounterId)) {
          encounterEntries.set(encounterId, []);
        }
        encounterEntries.get(encounterId).push(entry);
      } else {
        groups.unlinked.push(entry);
      }
    });

    encounterEntries.forEach((entries, encounterId) => {
      const sortedEntries = sortEntriesByTimestampDesc(entries);
      const fallbackTimestamp = getEntryTimestamp(sortedEntries[0]);
      const sourceEncounter = encounterMap.get(encounterId)
        || sortedEntries[0]?.encounter
        || {};
      const encounter = {
        ...sourceEncounter,
        id: sourceEncounter.id || encounterId,
        start_time: getEncounterDisplayStart(sourceEncounter, fallbackTimestamp),
        end_time: getEncounterDisplayEnd(sourceEncounter),
      };

      groups.encounters.push({
        encounter,
        entries: sortedEntries
      });
    });

    groups.encounters.sort((a, b) => {
      const dateA = toTimestampMs(a.encounter.start_time || getEntryTimestamp(a.entries[0])) || 0;
      const dateB = toTimestampMs(b.encounter.start_time || getEntryTimestamp(b.entries[0])) || 0;
      return dateB - dateA;
    });

    groups.unlinked = sortEntriesByTimestampDesc(groups.unlinked);

    return groups;
  }, [filteredEntries, encounters]);

  const totalCount = useMemo(() => getTimelineTotalCount(timelineDisplayData), [timelineDisplayData]);

  const mobileWorkspaceContext = useMemo(() => {
    const sortedTimelineEntries = sortEntriesByTimestampDesc(timelineEntries);
    const contextEncounter = chartContextEncounter || activeEncounter || null;
    const recentNotes = sortedTimelineEntries
      .filter(isNoteTimelineEntry)
      .slice(0, 3)
      .map((entry, index) => ({
        id: entry.id || `${entry.type || entry.entry_type || 'note'}-${getEntryTimestamp(entry) || index}`,
        title: getTimelineEntryTitle(entry),
        kind: entry.type || entry.entry_type || 'note',
        status: entry.status || entry.data?.status || null,
        timestamp: getEntryTimestamp(entry),
      }));

    return {
      patientName,
      entryCount: totalCount,
      visitLabel: isAllVisitsScope
        ? 'All history'
        : formatEncounterScopeLabel(contextEncounter, activeEncounter?.id),
      encounter: contextEncounter ? {
        id: contextEncounter.id,
        title: getEncounterTitle(contextEncounter),
        status: contextEncounter.status || null,
        dateRange: formatEncounterDateRange(contextEncounter),
      } : null,
      latestVitals: recentVitals.slice(0, 6),
      medications: medications.slice(0, 4).map((medication, index) => ({
        id: medication.id || medication.medication_id || `${medication.name || medication.medication_name || 'med'}-${index}`,
        name: medication.name || medication.medication_name || medication.drug_name || 'Medication',
        detail: compactMedicationDetail(medication),
      })),
      labs: labResults.slice(0, 4).map((lab, index) => ({
        id: lab.id || `${lab.name || 'lab'}-${lab.timestamp || index}`,
        name: lab.name,
        detail: compactLabDetail(lab),
        flag: lab.abnormal_direction || (lab.is_abnormal ? 'abnormal' : null),
      })),
      recentNotes,
      lastUpdated: sortedTimelineEntries[0] ? getEntryTimestamp(sortedTimelineEntries[0]) : null,
    };
  }, [
    activeEncounter,
    chartContextEncounter,
    isAllVisitsScope,
    labResults,
    medications,
    patientName,
    recentVitals,
    timelineEntries,
    totalCount,
  ]);

  return {
    filteredEntries,
    groupedByEncounter,
    mobileWorkspaceContext,
    totalCount,
  };
}

function ChronicleAccessDeniedState({
  breakGlassExpiresAt,
  breakGlassReason,
  canRequestBreakGlass,
  isBreakGlassOpen,
  isSubmitting,
  pageMeta,
  patient,
  patientName,
  rustV2Mode,
  onBreakGlassOpenChange,
  onBreakGlassReasonChange,
  onBreakGlassSubmit,
}) {
  const patientDetails = patient?.local_data || patient;
  const patientMrn = patientDetails?.medical_record_number || patientDetails?.mrn;

  return (
    <>
      {pageMeta}
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
                    onClick={() => onBreakGlassOpenChange(true)}
                    className="bg-[oklch(0.65_0.22_15)] text-white hover:bg-[oklch(0.60_0.22_15)]"
                  >
                    Request Break-Glass Access
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Provide a reason to unlock this record for a limited time.
                  </span>
                </div>
              ) : rustV2Mode ? (
                <p className="text-xs text-muted-foreground">
                  Break-glass access is not available in Rust V2 mode.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Break-glass access is available to clinical staff only.
                </p>
              )}
            </div>
          </div>
        </div>

        {canRequestBreakGlass && (
          <BreakGlassDialog
            open={isBreakGlassOpen}
            onOpenChange={onBreakGlassOpenChange}
            patientName={patientName}
            patientMrn={patientMrn}
            reason={breakGlassReason}
            onReasonChange={onBreakGlassReasonChange}
            onSubmit={onBreakGlassSubmit}
            isSubmitting={isSubmitting}
            ttlMinutes={30}
          />
        )}
      </div>
    </>
  );
}

function ChronicleLoadingState({ pageMeta }) {
  return (
    <>
      {pageMeta}
      <div className="min-h-screen bg-background">
        <div className="bg-card border-b border-border px-6 py-8">
          <Skeleton className="h-12 w-64 mb-4" />
          <Skeleton className="h-4 w-96 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>

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
    </>
  );
}

function ChronicleErrorState({ gateError, pageMeta, onRetry }) {
  return (
    <>
      {pageMeta}
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-display text-foreground">
            Unable to load patient record
          </h2>
          <p className="text-muted-foreground">
            {gateError?.message || 'An error occurred while fetching patient data.'}
          </p>
          <Button onClick={onRetry}>
            <RefreshCw className="size-4 mr-2" />
            Try Again
          </Button>
        </div>
      </div>
    </>
  );
}

function WardBoardQuickAction({ canOpenWardBoard, onOpenWardBoard }) {
  if (!canOpenWardBoard) {
    return null;
  }

  return (
    <div className="px-4 pt-4 sm:px-6">
      <Button
        variant="outline"
        size="sm"
        onClick={onOpenWardBoard}
        className="font-mono text-xs"
      >
        <ClipboardList className="size-4 mr-2" />
        Open Ward Board
      </Button>
    </div>
  );
}

function ChronicleDischargeClearance({ admissionId, canViewDischargeCase }) {
  if (!canViewDischargeCase || !admissionId) {
    return null;
  }

  return (
    <div className="px-6 pt-6">
      <DischargeCasePanel
        admissionId={admissionId}
        title="Discharge Clearance"
      />
    </div>
  );
}

function ChronicleSidebar({
  activeEncounter,
  allergies,
  isAnySlideOverOpen,
  labResults,
  medications,
  patient,
  patientId,
  problems,
  recentVitals,
  rustV2Mode,
  onViewFluidTrends,
  onViewVitalsTrends,
}) {
  return (
    <div
      className={cn(
        'hidden lg:flex lg:flex-col',
        isAnySlideOverOpen && 'lg:hidden',
      )}
    >
      <div className="w-80 border-r border-border bg-muted/20 p-6">
        {!rustV2Mode && <ProblemListSidebar patientId={patientId} />}
      </div>
      <ClinicalSummarySidebar
        patient={patient}
        problems={rustV2Mode ? problems : []}
        medications={medications}
        allergies={allergies}
        vitals={recentVitals}
        labResults={labResults}
        encounter={activeEncounter}
        onViewVitalsTrends={onViewVitalsTrends}
        onViewFluidTrends={onViewFluidTrends}
      />
    </div>
  );
}

function ChronicleTimelineTitle({
  activeEncounterId,
  documentedEncounterCount,
  encounterCount,
  isAllVisitsScope,
  isTimelineLoading,
  selectedEncounter,
  totalCount,
  onRefresh,
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Clock className="size-5 text-muted-foreground" />
          <h2 className="font-display text-xl text-foreground sm:text-2xl">
            Clinical Chronicle
          </h2>
          {totalCount > 0 && (
            <span className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
              {totalCount} {totalCount === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          {selectedEncounter && !isAllVisitsScope && (
            <p className="min-w-0 [overflow-wrap:anywhere] font-mono text-xs text-muted-foreground/80">
              Focused on {formatEncounterScopeLabel(selectedEncounter, activeEncounterId)}
            </p>
          )}
          {isAllVisitsScope && encounterCount > 0 && encounterCount > documentedEncounterCount && (
            <p className="font-mono text-xs text-muted-foreground/70" title="Some encounters have no clinical documentation">
              {encounterCount} encounters ({documentedEncounterCount} documented)
            </p>
          )}
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        aria-label="Refresh timeline"
        className="size-9 shrink-0 p-0 font-mono text-xs sm:w-auto sm:px-3"
      >
        <RefreshCw className={cn(
          "size-3.5 sm:mr-1.5",
          isTimelineLoading && "animate-spin"
        )} />
        <span className="hidden sm:inline">Refresh</span>
      </Button>
    </div>
  );
}

function VisitScopeSelector({
  activeEncounterId,
  isAllVisitsScope,
  resolvedVisitScope,
  selectedEncounterId,
  visitScopeOptions,
  onViewAllHistory,
  onViewCurrentVisit,
  onVisitScopeChange,
}) {
  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
      <div className="flex items-center gap-2">
        <Calendar className="size-4 text-muted-foreground" />
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Visit focus
        </span>
      </div>
      <Select
        value={resolvedVisitScope || CHRONICLE_ALL_VISITS}
        onValueChange={onVisitScopeChange}
      >
        <SelectTrigger className="w-full font-mono text-xs sm:min-w-[260px] sm:max-w-[420px]">
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
          onClick={onViewAllHistory}
          className="h-8 self-start px-2 font-mono text-xs"
        >
          All history
        </Button>
      )}
      {activeEncounterId && selectedEncounterId !== String(activeEncounterId) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewCurrentVisit}
          className="h-8 self-start px-2 font-mono text-xs"
        >
          Current visit
        </Button>
      )}
    </div>
  );
}

function ChronicleFilterTabs({ activeFilter, onFilterChange }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
      <Filter className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
      <div className="flex w-full min-w-0 max-w-full overflow-x-auto rounded-lg bg-muted p-1 [-webkit-overflow-scrolling:touch] sm:w-auto" data-onboarding="chronicle-filter-group">
        {CHRONICLE_FILTER_OPTIONS.map((filter) => {
          const FilterIcon = filter.icon;

          return (
            <button
              type="button"
              key={filter.key}
              onClick={() => onFilterChange(filter.key)}
              data-onboarding={filter.onboardingId}
              className={cn(
                "shrink-0 px-2 py-1.5 rounded-md font-mono text-xs transition-colors sm:px-3",
                "flex items-center gap-1 sm:gap-1.5",
                activeFilter === filter.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {FilterIcon && <FilterIcon className="size-3" />}
              {filter.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChronicleSearchAndFilters({
  activeFilter,
  isAllVisitsScope,
  searchInput,
  onCollapseAll,
  onExpandAll,
  onFilterChange,
  onSearchInputChange,
}) {
  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
      <div className="relative w-full min-w-0 sm:max-w-sm sm:flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search notes, prescriptions..."
          value={searchInput}
          onChange={(event) => onSearchInputChange(event.target.value)}
          className="pl-9 font-mono text-sm"
        />
      </div>

      <ChronicleFilterTabs
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
      />

      {isAllVisitsScope && (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onExpandAll}
            className="h-8 px-2 font-mono text-xs"
          >
            Expand visits
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCollapseAll}
            className="h-8 px-2 font-mono text-xs"
          >
            Collapse visits
          </Button>
        </div>
      )}
    </div>
  );
}

function ChronicleTimelineHeader({
  activeEncounterId,
  activeFilter,
  documentedEncounterCount,
  encounterCount,
  isAllVisitsScope,
  isTimelineLoading,
  resolvedVisitScope,
  searchInput,
  selectedEncounter,
  selectedEncounterId,
  totalCount,
  visitScopeOptions,
  onCollapseAll,
  onExpandAll,
  onFilterChange,
  onRefresh,
  onSearchInputChange,
  onViewAllHistory,
  onViewCurrentVisit,
  onVisitScopeChange,
}) {
  return (
    <div className="mb-6 space-y-4">
      <ChronicleTimelineTitle
        activeEncounterId={activeEncounterId}
        documentedEncounterCount={documentedEncounterCount}
        encounterCount={encounterCount}
        isAllVisitsScope={isAllVisitsScope}
        isTimelineLoading={isTimelineLoading}
        selectedEncounter={selectedEncounter}
        totalCount={totalCount}
        onRefresh={onRefresh}
      />
      <VisitScopeSelector
        activeEncounterId={activeEncounterId}
        isAllVisitsScope={isAllVisitsScope}
        resolvedVisitScope={resolvedVisitScope}
        selectedEncounterId={selectedEncounterId}
        visitScopeOptions={visitScopeOptions}
        onViewAllHistory={onViewAllHistory}
        onViewCurrentVisit={onViewCurrentVisit}
        onVisitScopeChange={onVisitScopeChange}
      />
      <ChronicleSearchAndFilters
        activeFilter={activeFilter}
        isAllVisitsScope={isAllVisitsScope}
        searchInput={searchInput}
        onCollapseAll={onCollapseAll}
        onExpandAll={onExpandAll}
        onFilterChange={onFilterChange}
        onSearchInputChange={onSearchInputChange}
      />
    </div>
  );
}

function TimelineEntryList({
  entries,
  expandedNoteIds,
  userId,
  onCopyNote,
  onEditNote,
  onNoteUpdated,
  onToggleNoteExpanded,
}) {
  return entries.map((entry, index) => (
    <TimelineEntry
      key={entry.id}
      entry={entry}
      index={index}
      currentUserId={userId}
      isNoteExpanded={entry.id !== null && entry.id !== undefined
        ? expandedNoteIds.has(String(entry.id))
        : false}
      onToggleNoteExpanded={onToggleNoteExpanded}
      onCopyNote={onCopyNote}
      onEditNote={onEditNote}
      onNoteUpdated={onNoteUpdated}
    />
  ));
}

function EncounterGroup({
  encounter,
  entries,
  expandedEncounters,
  expandedNoteIds,
  userId,
  onCopyNote,
  onEditNote,
  onRecordFluids,
  onToggleEncounter,
  onToggleNoteExpanded,
  onViewMedicationHistory,
  onNoteUpdated,
}) {
  const normalizedEncounterId = normalizeExpansionId(encounter.id);
  const isExpanded = normalizedEncounterId
    ? expandedEncounters.has(normalizedEncounterId)
    : false;
  const dateRange = formatEncounterDateRange(encounter, getEntryTimestamp(entries[0]));
  const encounterKind = getEncounterKind(encounter);
  const isInpatientKind = ['inpatient', 'admission', 'hospitalization'].includes(encounterKind);
  const TypeIcon = isInpatientKind ? Building2 : Calendar;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex w-full flex-col gap-3 p-3 text-left transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:px-4">
        <button
          type="button"
          onClick={() => onToggleEncounter(normalizedEncounterId)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left sm:items-center"
        >
          {isExpanded ? (
            <ChevronDown className="size-4 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 flex-shrink-0 text-muted-foreground" />
          )}

          <div className={cn(
            "shrink-0 rounded-lg p-2",
            isInpatientKind ? "bg-blue-500/10" : "bg-amber-500/10"
          )}>
            <TypeIcon className={cn(
              "size-4",
              isInpatientKind ? "text-blue-500" : "text-amber-500"
            )} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium capitalize">
                {getEncounterTitle(encounter)}
              </span>
              {encounter.status && (
                <span className={cn(
                  "rounded-full px-2 py-0.5 font-mono text-xs",
                  encounter.status === 'finished' && "bg-muted text-muted-foreground",
                  encounter.status === 'in-progress' && "bg-green-500/10 text-green-600",
                  encounter.status === 'cancelled' && "bg-red-500/10 text-red-600"
                )}>
                  {encounter.status}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
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
        </button>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="hidden xl:flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 font-mono text-[10px]"
              onClick={(event) => {
                event.stopPropagation();
                onViewMedicationHistory();
              }}
            >
              <Pill className="size-3.5 mr-1" />
              Meds
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 font-mono text-[10px]"
              onClick={(event) => {
                event.stopPropagation();
                onRecordFluids();
              }}
            >
              <Droplets className="size-3.5 mr-1" />
              Fluids
            </Button>
          </div>

          <span className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      </div>

      <div className={cn("min-w-0 space-y-3 border-t border-border p-3 sm:px-4", !isExpanded && "hidden")}>
        <TimelineEntryList
          entries={entries}
          expandedNoteIds={expandedNoteIds}
          userId={userId}
          onCopyNote={onCopyNote}
          onEditNote={onEditNote}
          onNoteUpdated={onNoteUpdated}
          onToggleNoteExpanded={onToggleNoteExpanded}
        />
      </div>
    </div>
  );
}

function UnlinkedEntriesGroup({
  entries,
  expandedEncounters,
  expandedNoteIds,
  userId,
  onCopyNote,
  onEditNote,
  onNoteUpdated,
  onToggleEncounter,
  onToggleNoteExpanded,
}) {
  if (entries.length === 0) {
    return null;
  }

  const isExpanded = expandedEncounters.has('unlinked');

  return (
    <div className="overflow-hidden rounded-lg border border-dashed border-border bg-card/50">
      <button
        type="button"
        onClick={() => onToggleEncounter('unlinked')}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
      >
        {isExpanded ? (
          <ChevronDown className="size-4 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 flex-shrink-0 text-muted-foreground" />
        )}

        <div className="rounded-lg bg-muted p-2">
          <AlertCircle className="size-4 text-muted-foreground" />
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
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </span>
      </button>

      <div className={cn("min-w-0 space-y-3 border-t border-dashed border-border p-3 sm:px-4", !isExpanded && "hidden")}>
        <TimelineEntryList
          entries={entries}
          expandedNoteIds={expandedNoteIds}
          userId={userId}
          onCopyNote={onCopyNote}
          onEditNote={onEditNote}
          onNoteUpdated={onNoteUpdated}
          onToggleNoteExpanded={onToggleNoteExpanded}
        />
      </div>
    </div>
  );
}

function TimelineInitialLoadingState({ isLoading }) {
  if (!isLoading) {
    return null;
  }

  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="pl-8 pb-6">
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}

function TimelineEmptyState({
  filteredEntryCount,
  isTimelineLoading,
  searchInput,
  selectedEncounterId,
  onClearSearch,
  onViewAllHistory,
}) {
  if (isTimelineLoading || filteredEntryCount > 0) {
    return null;
  }

  return (
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
          onClick={onClearSearch}
          className="mt-2 font-mono text-xs"
        >
          Clear search
        </Button>
      )}
      {!searchInput && selectedEncounterId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewAllHistory}
          className="mt-2 font-mono text-xs"
        >
          View all history
        </Button>
      )}
    </div>
  );
}

function TimelinePaginationState({
  filteredEntryCount,
  hasNextPage,
  isFetchingNextPage,
  loadMoreRef,
  onFetchNextPage,
}) {
  if (hasNextPage) {
    return (
      <div
        ref={loadMoreRef}
        className="flex items-center justify-center py-8"
      >
        {isFetchingNextPage ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="font-mono text-xs">Loading more…</span>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={onFetchNextPage}
            className="font-mono text-xs"
          >
            Load more
          </Button>
        )}
      </div>
    );
  }

  if (filteredEntryCount === 0) {
    return null;
  }

  return (
    <div className="py-8 text-center text-muted-foreground">
      <div className="mx-auto mb-2 h-px w-12 bg-border" />
      <p className="font-mono text-xs">End of timeline</p>
    </div>
  );
}

function ChronicleTimelineEntries({
  expandedEncounters,
  expandedNoteIds,
  filteredEntries,
  groupedByEncounter,
  loadMoreRef,
  searchInput,
  selectedEncounterId,
  timelineState,
  userId,
  onClearSearch,
  onCopyNote,
  onEditNote,
  onFetchNextPage,
  onNoteUpdated,
  onRecordFluids,
  onToggleEncounter,
  onToggleNoteExpanded,
  onViewAllHistory,
  onViewMedicationHistory,
}) {
  const {
    hasNextPage,
    isFetchingNextPage,
    isTimelineLoading,
    isVisitScopePending,
  } = timelineState;
  const isInitialLoading = (isTimelineLoading || isVisitScopePending) && filteredEntries.length === 0;

  return (
    <div className="relative min-w-0 max-w-full space-y-4">
      <TimelineInitialLoadingState isLoading={isInitialLoading} />

      {groupedByEncounter.encounters.map(({ encounter, entries }) => (
        <EncounterGroup
          key={encounter.id}
          encounter={encounter}
          entries={entries}
          expandedEncounters={expandedEncounters}
          expandedNoteIds={expandedNoteIds}
          userId={userId}
          onCopyNote={onCopyNote}
          onEditNote={onEditNote}
          onNoteUpdated={onNoteUpdated}
          onRecordFluids={onRecordFluids}
          onToggleEncounter={onToggleEncounter}
          onToggleNoteExpanded={onToggleNoteExpanded}
          onViewMedicationHistory={onViewMedicationHistory}
        />
      ))}

      <UnlinkedEntriesGroup
        entries={groupedByEncounter.unlinked}
        expandedEncounters={expandedEncounters}
        expandedNoteIds={expandedNoteIds}
        userId={userId}
        onCopyNote={onCopyNote}
        onEditNote={onEditNote}
        onNoteUpdated={onNoteUpdated}
        onToggleEncounter={onToggleEncounter}
        onToggleNoteExpanded={onToggleNoteExpanded}
      />

      <TimelineEmptyState
        filteredEntryCount={filteredEntries.length}
        isTimelineLoading={isTimelineLoading}
        searchInput={searchInput}
        selectedEncounterId={selectedEncounterId}
        onClearSearch={onClearSearch}
        onViewAllHistory={onViewAllHistory}
      />

      <TimelinePaginationState
        filteredEntryCount={filteredEntries.length}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMoreRef={loadMoreRef}
        onFetchNextPage={onFetchNextPage}
      />
    </div>
  );
}

function ChronicleTimelinePanel({
  activeEncounter,
  activeFilter,
  encounterCount,
  expandedEncounters,
  expandedNoteIds,
  filteredEntries,
  groupedByEncounter,
  loadMoreRef,
  searchInput,
  selectedEncounter,
  timelineState,
  totalCount,
  userId,
  visitState,
  visitScopeOptions,
  onClearSearch,
  onCollapseAll,
  onCopyNote,
  onEditNote,
  onExpandAll,
  onFetchNextPage,
  onFilterChange,
  onNoteUpdated,
  onRecordFluids,
  onRefresh,
  onSearchInputChange,
  onToggleEncounter,
  onToggleNoteExpanded,
  onViewAllHistory,
  onViewCurrentVisit,
  onViewMedicationHistory,
  onVisitScopeChange,
}) {
  const {
    isAllVisitsScope,
    resolvedVisitScope,
    selectedEncounterId,
  } = visitState;
  const { isTimelineLoading } = timelineState;

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl">
      <ChronicleTimelineHeader
        activeEncounterId={activeEncounter?.id}
        activeFilter={activeFilter}
        documentedEncounterCount={groupedByEncounter.encounters.length}
        encounterCount={encounterCount}
        isAllVisitsScope={isAllVisitsScope}
        isTimelineLoading={isTimelineLoading}
        resolvedVisitScope={resolvedVisitScope}
        searchInput={searchInput}
        selectedEncounter={selectedEncounter}
        selectedEncounterId={selectedEncounterId}
        totalCount={totalCount}
        visitScopeOptions={visitScopeOptions}
        onCollapseAll={onCollapseAll}
        onExpandAll={onExpandAll}
        onFilterChange={onFilterChange}
        onRefresh={onRefresh}
        onSearchInputChange={onSearchInputChange}
        onViewAllHistory={onViewAllHistory}
        onViewCurrentVisit={onViewCurrentVisit}
        onVisitScopeChange={onVisitScopeChange}
      />
      <ChronicleTimelineEntries
        expandedEncounters={expandedEncounters}
        expandedNoteIds={expandedNoteIds}
        filteredEntries={filteredEntries}
        groupedByEncounter={groupedByEncounter}
        loadMoreRef={loadMoreRef}
        searchInput={searchInput}
        selectedEncounterId={selectedEncounterId}
        timelineState={timelineState}
        userId={userId}
        onClearSearch={onClearSearch}
        onCopyNote={onCopyNote}
        onEditNote={onEditNote}
        onFetchNextPage={onFetchNextPage}
        onNoteUpdated={onNoteUpdated}
        onRecordFluids={onRecordFluids}
        onToggleEncounter={onToggleEncounter}
        onToggleNoteExpanded={onToggleNoteExpanded}
        onViewAllHistory={onViewAllHistory}
        onViewMedicationHistory={onViewMedicationHistory}
      />
    </div>
  );
}

function WardRoundChronicleMode({
  activeEncounter,
  admission,
  chronicleContext,
  labResults,
  latestVitals,
  medications,
  patient,
  patientId,
  onCommitted,
}) {
  return (
    <Suspense fallback={(
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )}>
      <WardRoundMode
        patientId={patientId}
        patient={patient}
        admission={admission}
        encounter={activeEncounter}
        chronicleContext={chronicleContext}
        latestVitals={latestVitals}
        labResults={labResults}
        medications={medications}
        onCommitted={onCommitted}
      />
    </Suspense>
  );
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
  const { pathname, search } = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { data: deploymentCapabilities } = useSystemCapabilities({ enabled: !authLoading });
  const queryClient = useQueryClient();
  const openedPatientChartsRef = useRef(new Set());
  const lastFilterEventRef = useRef(null);
  const encounterExpansionSeedRef = useRef(null);
  const noteExpansionSeedRef = useRef(null);
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [expandedEncounters, setExpandedEncounters] = useState(() => new Set());
  const [expandedNoteIds, setExpandedNoteIds] = useState(() => new Set());

  // Copy forward state - holds template and data for pre-filling note editor
  const [copyForwardData, setCopyForwardData] = useState(null);

  // Edit note state - holds note ID and data for editing existing notes
  const [editNoteData, setEditNoteData] = useState(null);
  const [requestedDischargeAdmission, setRequestedDischargeAdmission] = useState(null);
  const [requestedTreatmentSheetAdmissionId, setRequestedTreatmentSheetAdmissionId] = useState(null);
  const requestedDischargeAdmissionId = requestedDischargeAdmission?.patientId === id
    ? requestedDischargeAdmission.admissionId
    : null;
  const setRequestedDischargeAdmissionId = useCallback((admissionId) => {
    setRequestedDischargeAdmission(admissionId
      ? { patientId: id, admissionId: String(admissionId) }
      : null);
  }, [id]);
  const rustV2Mode = isRustV2ApiMode();
  const canUseStandaloneClinicalWorkflows = !rustV2Mode;
  const canUseAiAssistant = !rustV2Mode;

  const [isBreakGlassOpen, setBreakGlassOpen] = useState(false);
  const [breakGlassReason, setBreakGlassReason] = useState('');
  const [breakGlassExpiresAt, setBreakGlassExpiresAt] = useState(null);

  // Check for action query params (e.g., from referral inbox)
  const actionParam = searchParams.get('action');
  const referralIdParam = searchParams.get('referral_id');
  const admissionParam = searchParams.get('admission');
  const visitParam = searchParams.get(CHRONICLE_VISIT_PARAM);
  const chronicleModeParam = searchParams.get('mode');
  const wardRoundParam = searchParams.get('wardRound');
  const consultationParam = searchParams.get('consultation');
  const isWardRoundMode = chronicleModeParam === 'ward-round' || defaultAction === 'ward_round';
  const [trendReviewTab, setTrendReviewTab] = useState('vitals');

  const {
    data: chronicleStartup,
    isLoading: isStartupLoading,
    error: startupError,
    refetch: refetchStartup,
  } = usePatientChronicleStartup(id, {}, {
    enabled: rustV2Mode,
  });

  // Fetch patient data (includes access flags for conditional fetching)
  const {
    data: legacyPatient,
    isLoading: isPatientLoading,
    error: patientError,
    refetch: refetchPatient,
  } = usePatient(id, {
    enabled: !rustV2Mode,
  });
  const patient = rustV2Mode ? chronicleStartup?.patient : legacyPatient;
  const isLoading = rustV2Mode ? isStartupLoading : isPatientLoading;
  const error = rustV2Mode ? startupError : patientError;
  const patientName = useMemo(() => resolvePatientDisplayName(patient), [patient]);
  const patientPath = id ? `/patients/${id}` : '/patients';
  const pageMeta = usePageMeta({
    title: patientName ? `${patientName} | Hospital Management System` : 'Patient | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: patientName || 'Patient', path: patientPath },
    ],
  });

  // Check if user has clinical access (from patient endpoint response).
  // Rust V2 enforces Chronicle access through the shaped startup read.
  const hasClinicalAccess = rustV2Mode
    ? startupError?.status !== 403
    : patient?.access?.clinical === true;
  const patientLocalId = patient?.local_data?.id || patient?.id || id;
  const patientIdentityId = patient?.local_data?.patient_identity_id || patient?.patient_identity_id || null;
  const rustV2ActiveAdmission = rustV2Mode
    ? chronicleStartup?.active_admission || chronicleStartup?.active_context?.admission || null
    : null;
  const rustV2ActiveAdmissionId = rustV2Mode
    ? rustV2ActiveAdmission?.admission_id || rustV2ActiveAdmission?.id || null
    : null;
  const patientForChronicle = useMemo(() => {
    if (!patient || !rustV2ActiveAdmissionId) {
      return patient;
    }

    const localData = patient.local_data || {};
    return {
      ...patient,
      current_admission_id: patient.current_admission_id || rustV2ActiveAdmissionId,
      current_ward_id: patient.current_ward_id || rustV2ActiveAdmission?.ward_id || null,
      current_ward: patient.current_ward || rustV2ActiveAdmission?.ward_name || null,
      current_bed: patient.current_bed || rustV2ActiveAdmission?.bed_code || rustV2ActiveAdmission?.bed_number || null,
      local_data: {
        ...localData,
        current_admission_id: localData.current_admission_id || rustV2ActiveAdmissionId,
        current_ward_id: localData.current_ward_id || rustV2ActiveAdmission?.ward_id || null,
        current_ward: localData.current_ward || rustV2ActiveAdmission?.ward_name || null,
        current_bed: localData.current_bed || rustV2ActiveAdmission?.bed_code || rustV2ActiveAdmission?.bed_number || null,
      },
    };
  }, [
    patient,
    rustV2ActiveAdmission?.bed_code,
    rustV2ActiveAdmission?.bed_number,
    rustV2ActiveAdmission?.ward_id,
    rustV2ActiveAdmission?.ward_name,
    rustV2ActiveAdmissionId,
  ]);
  const {
    clearQueryParams,
    openChronicleWorkspace,
    openWardRoundMode,
    prefetchActionResources,
    slideOvers,
  } = useChronicleWorkspaceRouting({
    id,
    navigate,
    patientLocalId,
    pathname,
    queryClient,
    search,
  });

  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-event-handler -- Route/default action params are external navigation commands; this effect is the boundary that opens the matching Chronicle workspace once patient context is available.
    const action = actionParam || defaultAction;
    if (action === 'add_note') {
      openChronicleWorkspace('note');
      // Clear the query params after opening
      if (actionParam) clearQueryParams();
    } else if (action === 'ward_round' || wardRoundParam === 'true') {
      if (actionParam || wardRoundParam) {
        openWardRoundMode();
      }
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

      // oxlint-disable-next-line react-doctor/no-adjust-state-on-prop-change -- Preserve the route-requested admission after transient query params are cleared while the discharge workspace remains open.
      setRequestedDischargeAdmissionId(String(admissionId));
      if (!canUseStandaloneClinicalWorkflows) {
        if (actionParam || admissionParam) clearQueryParams();
        return;
      }
      openChronicleWorkspace('discharge');
      if (actionParam || admissionParam) clearQueryParams();
    } else if (action === 'add_prescription') {
      openChronicleWorkspace('prescription');
      if (actionParam) clearQueryParams();
    } else if (action === 'treatment_sheet') {
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

      // oxlint-disable-next-line react-doctor/no-adjust-state-on-prop-change -- Preserve the route-requested admission after transient query params are cleared while the treatment sheet workspace remains open.
      setRequestedTreatmentSheetAdmissionId(String(admissionId));
      openChronicleWorkspace('treatmentSheet');
      if (actionParam || admissionParam) clearQueryParams();
    }
  }, [
    actionParam,
    admissionParam,
    canUseStandaloneClinicalWorkflows,
    clearQueryParams,
    consultationParam,
    defaultAction,
    openChronicleWorkspace,
    openWardRoundMode,
    patient,
    setRequestedDischargeAdmissionId,
    setRequestedTreatmentSheetAdmissionId,
    wardRoundParam,
  ]);

  // Debounce search input
  const debouncedSearch = useDebounce(searchInput, 300);

  // Check if any slide-over is open (for timeline compression)
  const isAnySlideOverOpen = slideOvers.activeSlideOver !== null;
  const isCopilotSlideOverOpen = slideOvers.isOpen('copilot');

  // ====== TIER 1: Chronicle Context (optimized single-call) ======
  // Only fetch if user has clinical access - prevents wasted 403 requests
  const {
    data: legacyChronicleContext,
    isLoading: isLegacyContextLoading,
    error: legacyContextError,
    refetch: refetchLegacyContext,
  } = useChronicleContext(id, {
    enabled: !rustV2Mode && hasClinicalAccess,
  });

  const chronicleContext = rustV2Mode ? chronicleStartup : legacyChronicleContext;
  const isContextLoading = rustV2Mode ? false : isLegacyContextLoading;
  const contextError = rustV2Mode ? startupError : legacyContextError;
  const refetchContext = rustV2Mode ? refetchStartup : refetchLegacyContext;

  const canFetchClinical = hasClinicalAccess;
  const canViewDischargeCase = !rustV2Mode && DISCHARGE_CASE_ROLES.has(user?.user_type);

  // Fetch patient encounters for grouping
  const {
    data: legacyEncounters,
    isLoading: areLegacyEncountersLoading,
    refetch: refetchEncounters,
  } = usePatientEncounters(id, {
    enabled: !rustV2Mode && canFetchClinical,
  });
  const rustV2Encounters = useMemo(
    () => {
      const encountersById = new Map();

      if (Array.isArray(chronicleContext?.encounters)) {
        chronicleContext.encounters.forEach((encounter) => {
          if (encounter?.id !== null && encounter?.id !== undefined) {
            encountersById.set(String(encounter.id), encounter);
          }
        });
      }

      if (chronicleContext?.active_encounter?.id !== null && chronicleContext?.active_encounter?.id !== undefined) {
        encountersById.set(String(chronicleContext.active_encounter.id), chronicleContext.active_encounter);
      }

      return Array.from(encountersById.values());
    },
    [chronicleContext?.active_encounter, chronicleContext?.encounters],
  );
  const encounters = rustV2Mode ? rustV2Encounters : legacyEncounters;
  const areEncountersLoading = rustV2Mode ? false : areLegacyEncountersLoading;

  // Fetch patient insurance (only if user has clinical access)
  const { data: insuranceData } = usePatientInsurance(id, {}, {
    enabled: !rustV2Mode && hasClinicalAccess,
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
      (getEncounterKind(encounter) || 'outpatient') === 'outpatient'
      && encounter.status === 'planned'
      && activeOutpatientVisitStatuses.has(encounter.outpatient_visit_status)
    )) || null;
  }, [encounters]);

  const chronicleActiveAdmission = useMemo(() => {
    if (rustV2ActiveAdmission) {
      return rustV2ActiveAdmission;
    }
    if (
      activeEncounter
      && ['inpatient', 'admission', 'emergency', 'hospitalization'].includes(getEncounterKind(activeEncounter))
    ) {
      return activeEncounter;
    }
    return null;
  }, [activeEncounter, rustV2ActiveAdmission]);

  const enabledFeatures = deploymentCapabilities?.features;
  const hasWardBoardContext = Boolean(
    patient?.local_data?.current_admission_id
    || patient?.current_admission_id
    || rustV2ActiveAdmissionId
    || chronicleActiveAdmission
  );
  const canOpenWardBoard = hasWardBoardContext
    && enabledFeatures?.ward_task_board === true
    && enabledFeatures?.patient_chronicle === true
    && enabledFeatures?.wards === true
    && enabledFeatures?.inpatient_admissions === true
    && enabledFeatures?.nursing_workflows === true;
  const wardBoardHref = useMemo(() => {
    const boardPatientId = patientLocalId || id;
    return boardPatientId
      ? `/ward-board?patient=${encodeURIComponent(boardPatientId)}`
      : '/ward-board';
  }, [id, patientLocalId]);
  const handleOpenWardBoard = useCallback(() => {
    navigate(wardBoardHref);
  }, [navigate, wardBoardHref]);

  const resolvedVisitScope = useMemo(() => resolveChronicleVisitScope({
    requestedVisit: visitParam || (rustV2Mode ? CHRONICLE_ALL_VISITS : undefined),
    activeEncounterId: chronicleContext?.active_encounter?.id || activeEncounter?.id,
    encounters,
    areEncountersLoading,
  }), [
    activeEncounter?.id,
    areEncountersLoading,
    chronicleContext?.active_encounter?.id,
    encounters,
    rustV2Mode,
    visitParam,
  ]);
  const isAllVisitsScope = resolvedVisitScope === CHRONICLE_ALL_VISITS;
  const selectedEncounterId = !resolvedVisitScope || isAllVisitsScope ? null : resolvedVisitScope;
  const isVisitScopePending = canFetchClinical && !resolvedVisitScope;
  const selectedEncounter = useMemo(
    () => encounters?.find((encounter) => String(encounter.id) === String(selectedEncounterId)) || null,
    [encounters, selectedEncounterId]
  );
  const chartContextEncounter = useMemo(() => {
    if (isAllVisitsScope) {
      return null;
    }
    return selectedEncounter || activeEncounter || null;
  }, [activeEncounter, isAllVisitsScope, selectedEncounter]);
  const chartContextAdmissionId = chartContextEncounter?.admission_id
    || chartContextEncounter?.admission?.id
    || rustV2ActiveAdmissionId
    || null;
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

  // Use chronicle context data directly - no more legacy fallback needed
  const medications = useMemo(
    () => chronicleContext?.active_medications || chronicleContext?.summaries?.medications || [],
    [chronicleContext?.active_medications, chronicleContext?.summaries?.medications],
  );
  const parsedAllergies = chronicleContext?.allergies || chronicleContext?.summaries?.allergies || [];

  // Get latest vitals from context
  const latestVitals = chronicleContext?.latest_vitals;
  const recentVitals = useMemo(() => (
    normalizeLatestVitalsForSidebar(latestVitals)
  ), [latestVitals]);

  const labResults = useMemo(() => {
    const shapedLabs = chronicleContext?.lab_results || chronicleContext?.summaries?.labs || [];
    return normalizeLabResultsForSidebar(shapedLabs);
  }, [chronicleContext?.lab_results, chronicleContext?.summaries?.labs]);

  // Map filter to API type
  // Fetch timeline with infinite scroll
  // Uses id from URL params to start fetching immediately in parallel with patient data
  const chronicleTimelineParams = useMemo(() => ({
    type: CHRONICLE_TYPE_MAPPING[activeFilter] || 'all',
    search: debouncedSearch,
    limit: 20,
    encounterId: selectedEncounterId || undefined,
  }), [activeFilter, debouncedSearch, selectedEncounterId]);
  const canSeedRustTimeline = rustV2Mode
    && chronicleTimelineParams.type === 'all'
    && !chronicleTimelineParams.search
    && !chronicleTimelineParams.encounterId
    && hasSeedableTimelinePage(chronicleContext?.timeline);
  const rustTimelineQuery = usePatientChronicleTimeline(id, chronicleTimelineParams, {
    enabled: !isWardRoundMode && rustV2Mode && canFetchClinical && !!resolvedVisitScope && !!chronicleContext && !canSeedRustTimeline,
    initialPage: canSeedRustTimeline ? chronicleContext.timeline : undefined,
  });
  const legacyTimelineQuery = usePatientTimeline(id, {
    type: chronicleTimelineParams.type,
    search: chronicleTimelineParams.search,
    pageSize: chronicleTimelineParams.limit,
    encounterId: chronicleTimelineParams.encounterId,
    enabled: !isWardRoundMode && !rustV2Mode && canFetchClinical && !!resolvedVisitScope,
  });
  const activeTimelineQuery = rustV2Mode ? rustTimelineQuery : legacyTimelineQuery;
  const {
    data: timelineData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isTimelineLoading,
    refetch: refetchTimeline,
  } = activeTimelineQuery;
  const seededRustTimelineData = useMemo(
    () => buildTimelineDataFromInitialPage(canSeedRustTimeline ? chronicleContext?.timeline : null),
    [canSeedRustTimeline, chronicleContext?.timeline],
  );
  const timelineDisplayData = useMemo(() => {
    if (seededRustTimelineData && !hasTimelinePageResults(timelineData)) {
      return seededRustTimelineData;
    }

    return timelineData;
  }, [seededRustTimelineData, timelineData]);

  useEffect(() => {
    if (!id || !seededRustTimelineData) {
      return;
    }

    queryClient.setQueryData(
      patientKeys.chronicleTimeline(id, chronicleTimelineParams),
      (current) => {
        if (Array.isArray(current?.pages) && current.pages.length > 1) {
          return current;
        }
        return seededRustTimelineData;
      },
    );
  }, [chronicleTimelineParams, id, queryClient, seededRustTimelineData]);

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
      // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent -- IntersectionObserver observes a DOM sentinel; no React parent callback or lifted state is involved.
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Use allergies from clinical summary hook (already parsed from patient data)
  // The hook handles parsing from string/array formats
  const allergies = parsedAllergies;
  const problemSummaries = chronicleContext?.problems || chronicleContext?.summaries?.problems || [];
  const {
    filteredEntries,
    groupedByEncounter,
    mobileWorkspaceContext,
    totalCount,
  } = useChronicleTimelineViewModel({
    activeEncounter,
    activeFilter,
    chartContextEncounter,
    encounters,
    isAllVisitsScope,
    labResults,
    medications,
    patientName,
    recentVitals,
    timelineDisplayData,
  });

  const dischargeCaseAdmissionId = useMemo(() => (
    requestedDischargeAdmissionId
    || patient?.local_data?.current_admission_id
    || patient?.current_admission_id
    || rustV2ActiveAdmissionId
    || activeEncounter?.admission_id
    || null
  ), [
    activeEncounter?.admission_id,
    patient?.current_admission_id,
    patient?.local_data?.current_admission_id,
    requestedDischargeAdmissionId,
    rustV2ActiveAdmissionId,
  ]);

  const expansionSeedKey = `${id}:${resolvedVisitScope || 'pending'}:${activeFilter}:${debouncedSearch.trim().toLowerCase()}`;

  // Use stable length values instead of array references to avoid spurious re-runs.
  // The seed key already captures meaningful changes (patient, visit scope, filter, search).
  const encounterGroupCount = groupedByEncounter.encounters.length;
  const unlinkedEntryCount = groupedByEncounter.unlinked.length;

  useEffect(() => {
    if (encounterGroupCount > 0 && areEncountersLoading) {
      return;
    }
    if (encounterGroupCount === 0 && unlinkedEntryCount === 0) {
      return;
    }
    if (encounterExpansionSeedRef.current === expansionSeedKey) {
      return;
    }

    // oxlint-disable-next-line react-doctor/no-derived-state -- Expansion is user-controlled UI state seeded once per patient/visit/filter key; recomputing each render would erase manual toggles.
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
    encounterGroupCount,
    groupedByEncounter.encounters,
    groupedByEncounter.unlinked,
    unlinkedEntryCount,
  ]);

  useEffect(() => {
    if (filteredEntries.length === 0) {
      return;
    }
    if (noteExpansionSeedRef.current === expansionSeedKey) {
      return;
    }

    // oxlint-disable-next-line react-doctor/no-derived-state -- Note expansion is user-controlled UI state seeded once per patient/visit/filter key; recomputing each render would erase manual toggles.
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

  useEffect(() => {
    if (!visitParam || !resolvedVisitScope || visitParam === resolvedVisitScope) {
      return;
    }

    const nextSearch = buildChronicleSearch(search, {
      updates: {
        [CHRONICLE_VISIT_PARAM]: resolvedVisitScope,
      },
    });

    navigate({ pathname, search: nextSearch }, { replace: true });
  }, [navigate, pathname, resolvedVisitScope, search, visitParam]);

  // ============================================
  // Event handlers
  // ============================================

  // Refresh data after any slide-over action
  const refreshData = useCallback(() => {
    if (rustV2Mode) {
      Promise.all([
        refetchStartup?.(),
        refetchTimeline?.(),
      ]);
      return;
    }

    Promise.all([
      invalidateTimeline(id),
      refetchPatient(),
      refetchContext(),
    ]);
  }, [id, invalidateTimeline, refetchContext, refetchPatient, refetchStartup, refetchTimeline, rustV2Mode]);

  // Slide-over handlers - using the centralized hook
  const handleAskChronicle = useCallback(() => {
    if (!canUseAiAssistant) {
      toast.error('Chronicle copilot is not available in Rust V2 mode yet.');
      return;
    }
    openChronicleWorkspace('copilot');
  }, [canUseAiAssistant, openChronicleWorkspace]);
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
    openWardRoundMode();
  }, [openWardRoundMode]);
  const handleStartDischarge = useCallback(() => {
    const admissionId = patient?.local_data?.current_admission_id
      || patient?.current_admission_id
      || rustV2ActiveAdmissionId
      || activeEncounter?.admission_id;

    if (!admissionId) {
      toast.error('No active admission found for this patient');
      return;
    }

    setRequestedDischargeAdmissionId(String(admissionId));
    if (!canUseStandaloneClinicalWorkflows) {
      return;
    }
    openChronicleWorkspace('discharge');
  }, [patient, activeEncounter, rustV2ActiveAdmissionId, canUseStandaloneClinicalWorkflows, openChronicleWorkspace, setRequestedDischargeAdmissionId]);

  // Close handler with data refresh
  const handleSlideOverClose = useCallback(() => {
    slideOvers.close();
    setCopyForwardData(null); // Clear copy forward data when closing
    setEditNoteData(null); // Clear edit note data when closing
    setRequestedDischargeAdmissionId(null);
  }, [setRequestedDischargeAdmissionId, slideOvers]);

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
  }, [refreshData, setRequestedDischargeAdmissionId, slideOvers]);

  const handleViewMedicationHistory = useCallback(() => {
    openChronicleWorkspace('medicationHistory');
  }, [openChronicleWorkspace]);

  const handleViewTrends = useCallback((tab = 'vitals') => {
    setTrendReviewTab(tab);
    openChronicleWorkspace('trends');
  }, [openChronicleWorkspace]);

  const handleManageInsurance = useCallback(() => {
    openChronicleWorkspace('insurance');
  }, [openChronicleWorkspace]);

  const handlePrintSummary = useCallback(() => {
    if (!id) {
      return;
    }

    const printParams = new URLSearchParams();
    const printVisitScope = selectedEncounterId || CHRONICLE_ALL_VISITS;
    printParams.set(CHRONICLE_VISIT_PARAM, printVisitScope);

    const printType = CHRONICLE_TYPE_MAPPING[activeFilter] || 'all';
    if (printType !== 'all') {
      printParams.set('type', printType);
    }

    const trimmedSearch = searchInput.trim();
    if (trimmedSearch) {
      printParams.set('search', trimmedSearch);
    }

    window.open(
      `/patients/${id}/chronicle/print?${printParams.toString()}`,
      '_blank',
      'noopener,noreferrer',
    );
  }, [activeFilter, id, searchInput, selectedEncounterId]);

  const handleVisitScopeChange = useCallback((nextVisitScope) => {
    const nextSearch = buildChronicleSearch(search, {
      updates: {
        [CHRONICLE_VISIT_PARAM]: nextVisitScope,
      },
    });

    navigate({ pathname, search: nextSearch }, { replace: true });
  }, [navigate, pathname, search]);

  const handleViewAllHistory = useCallback(() => {
    handleVisitScopeChange(CHRONICLE_ALL_VISITS);
  }, [handleVisitScopeChange]);

  const handleViewCurrentVisit = useCallback(() => {
    if (!activeEncounter?.id) {
      return;
    }

    handleVisitScopeChange(String(activeEncounter.id));
  }, [activeEncounter?.id, handleVisitScopeChange]);

  const handleClearTimelineSearch = useCallback(() => {
    setSearchInput('');
  }, []);

  const chronicleVisitState = useMemo(() => ({
    isAllVisitsScope,
    resolvedVisitScope,
    selectedEncounterId,
  }), [isAllVisitsScope, resolvedVisitScope, selectedEncounterId]);

  const chronicleTimelineState = useMemo(() => ({
    hasNextPage,
    isFetchingNextPage,
    isTimelineLoading,
    isVisitScopePending,
  }), [hasNextPage, isFetchingNextPage, isTimelineLoading, isVisitScopePending]);

  const handleConsultationCompleted = useCallback(() => {
    refetchTimeline?.();
    refetchContext?.();
  }, [refetchTimeline, refetchContext]);

  const workspaceContext = useMemo(() => ({
    patientId: id,
    patient: patientForChronicle,
    activeEncounter,
    selectedEncounter: chartContextEncounter,
    selectedEncounterId: chartContextEncounter?.id || null,
    selectedAdmissionId: chartContextAdmissionId,
    chronicleAllHistory: isAllVisitsScope,
    initialTrendTab: trendReviewTab,
    patientIdentityId,
    referralId: referralIdParam,
    copilotPatientName,
    copyForwardData,
    editNoteData,
    requestedDischargeAdmissionId,
    requestedTreatmentSheetAdmissionId,
    mobileContext: mobileWorkspaceContext,
    onClose: handleSlideOverClose,
    onNoteCreated: handleNoteCreated,
    onVitalsRecorded: handleVitalsRecorded,
    onPrescriptionCreated: handlePrescriptionCreated,
    onLabOrderCreated: handleLabOrderCreated,
    onReferralCreated: handleReferralCreated,
    onFluidRecorded: refreshData,
    onWardRoundCompleted: handleWardRoundCompleted,
    onConsultationCompleted: handleConsultationCompleted,
    onDischargeCompleted: handleDischargeCompleted,
  }), [
    id,
    patientForChronicle,
    activeEncounter,
    chartContextEncounter,
    chartContextAdmissionId,
    isAllVisitsScope,
    trendReviewTab,
    patientIdentityId,
    referralIdParam,
    copilotPatientName,
    copyForwardData,
    editNoteData,
    requestedDischargeAdmissionId,
    requestedTreatmentSheetAdmissionId,
    mobileWorkspaceContext,
    handleSlideOverClose,
    handleNoteCreated,
    handleVitalsRecorded,
    handlePrescriptionCreated,
    handleLabOrderCreated,
    handleReferralCreated,
    refreshData,
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
                        patient?.current_admission_id ||
                        rustV2ActiveAdmissionId;

    if (admissionId) {
      setRequestedTreatmentSheetAdmissionId(String(admissionId));
      openChronicleWorkspace('treatmentSheet');
    } else {
      toast.error('No active admission found for this patient');
    }
  }, [activeEncounter, patient, rustV2ActiveAdmissionId, openChronicleWorkspace]);

  const userRole = user?.role || user?.user_type;
  const canRequestBreakGlass = !rustV2Mode && ['admin', 'doctor', 'nurse'].includes(userRole);
  // Access denied if patient loaded but user lacks clinical access
  const accessDenied = rustV2Mode
    ? !isLoading && startupError?.status === 403
    : patient && !isLoading && patient?.access?.clinical === false;
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
      queryClient.invalidateQueries({ queryKey: patientKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: patientKeys.chronicleStartup(id) });
      queryClient.invalidateQueries({ queryKey: timelineKeys.list(id) });
      queryClient.invalidateQueries({ queryKey: encounterKeys.forPatient(id) });
      refetchPatient();
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
    if (rustV2Mode) {
      toast.error('Break-glass access is not available in Rust V2 mode.');
      return;
    }

    if (!breakGlassReason.trim()) {
      return;
    }
    breakGlassMutation.mutate({
      reason: breakGlassReason.trim(),
      scope: 'clinical',
    });
  }, [breakGlassReason, breakGlassMutation, rustV2Mode]);

  // ============================================
  // Loading state
  // ============================================

  if (accessDenied) {
    return (
      <ChronicleAccessDeniedState
        breakGlassExpiresAt={breakGlassExpiresAt}
        breakGlassReason={breakGlassReason}
        canRequestBreakGlass={canRequestBreakGlass}
        isBreakGlassOpen={isBreakGlassOpen}
        isSubmitting={breakGlassMutation.isPending}
        pageMeta={pageMeta}
        patient={patient}
        patientName={patientName}
        rustV2Mode={rustV2Mode}
        onBreakGlassOpenChange={setBreakGlassOpen}
        onBreakGlassReasonChange={setBreakGlassReason}
        onBreakGlassSubmit={handleBreakGlassSubmit}
      />
    );
  }

  if (isLoading || isContextLoading || authLoading) {
    return <ChronicleLoadingState pageMeta={pageMeta} />;
  }

  // ============================================
  // Error state
  // ============================================

  if (hasGateError) {
    return (
      <ChronicleErrorState
        gateError={gateError}
        pageMeta={pageMeta}
        onRetry={() => {
          refetchPatient();
          refetchContext();
        }}
      />
    );
  }

  // ============================================
  // Render
  // ============================================

  return (
    <>
      {pageMeta}
      <div className="min-h-screen max-w-full overflow-x-hidden bg-background">
        {/* Patient Identity Hero */}
        <PatientIdentityHero
          patient={patientForChronicle}
          allergies={allergies}
          onActionIntent={rustV2Mode ? undefined : prefetchActionResources}
          onAskChronicle={canUseAiAssistant ? handleAskChronicle : undefined}
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
          onStartWardRound={handleStartWardRound}
          onStartDischarge={canUseStandaloneClinicalWorkflows ? handleStartDischarge : undefined}
          onManageInsurance={handleManageInsurance}
          onPrintSummary={handlePrintSummary}
          insurance={patientInsurance}
          activeAdmission={chronicleActiveAdmission}
        />

        <WardBoardQuickAction
          canOpenWardBoard={canOpenWardBoard}
          onOpenWardBoard={handleOpenWardBoard}
        />

        <ChronicleDischargeClearance
          admissionId={dischargeCaseAdmissionId}
          canViewDischargeCase={canViewDischargeCase}
        />

        {/* Main Content: Sidebar + Timeline */}
        <div className={cn(
          "flex min-w-0 max-w-full overflow-x-hidden transition-all duration-300",
          isCopilotSlideOverOpen
            ? "lg:mr-[34rem]"
            : isAnySlideOverOpen && "lg:mr-[50%]"
        )}>
          <ChronicleSidebar
            activeEncounter={activeEncounter}
            allergies={allergies}
            isAnySlideOverOpen={isAnySlideOverOpen}
            labResults={labResults}
            medications={medications}
            patient={patientForChronicle}
            patientId={id}
            problems={problemSummaries}
            recentVitals={recentVitals}
            rustV2Mode={rustV2Mode}
            onViewVitalsTrends={() => handleViewTrends('vitals')}
            onViewFluidTrends={() => handleViewTrends('fluids')}
          />
          {/* Timeline Chronicle or single-page Chronicle mode */}
          <main className="min-w-0 flex-1 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] transition-all duration-300 sm:p-6">
          {isWardRoundMode ? (
            <WardRoundChronicleMode
              activeEncounter={activeEncounter}
              admission={chronicleActiveAdmission}
              chronicleContext={chronicleContext}
              labResults={labResults}
              latestVitals={latestVitals}
              medications={medications}
              patient={patientForChronicle}
              patientId={patientLocalId || id}
              onCommitted={refreshData}
            />
          ) : (
          <ChronicleTimelinePanel
            activeEncounter={activeEncounter}
            activeFilter={activeFilter}
            encounterCount={encounters?.length || 0}
            expandedEncounters={expandedEncounters}
            expandedNoteIds={expandedNoteIds}
            filteredEntries={filteredEntries}
            groupedByEncounter={groupedByEncounter}
            loadMoreRef={loadMoreRef}
            searchInput={searchInput}
            selectedEncounter={selectedEncounter}
            timelineState={chronicleTimelineState}
            totalCount={totalCount}
            userId={user?.id}
            visitState={chronicleVisitState}
            visitScopeOptions={visitScopeOptions}
            onClearSearch={handleClearTimelineSearch}
            onCollapseAll={collapseAll}
            onCopyNote={handleCopyNote}
            onEditNote={handleEditNote}
            onExpandAll={expandAll}
            onFetchNextPage={fetchNextPage}
            onFilterChange={setActiveFilter}
            onNoteUpdated={refetchTimeline}
            onRecordFluids={handleRecordFluids}
            onRefresh={refetchTimeline}
            onSearchInputChange={setSearchInput}
            onToggleEncounter={toggleEncounter}
            onToggleNoteExpanded={toggleNoteExpanded}
            onViewAllHistory={handleViewAllHistory}
            onViewCurrentVisit={handleViewCurrentVisit}
            onViewMedicationHistory={handleViewMedicationHistory}
            onVisitScopeChange={handleVisitScopeChange}
          />
          )}
          </main>

          <ChronicleWorkspaceHost
            activeWorkspace={slideOvers.activeSlideOver}
            workspaceContext={workspaceContext}
          />
        </div>
      </div>
    </>
  );
};

export default PatientChroniclePage;
