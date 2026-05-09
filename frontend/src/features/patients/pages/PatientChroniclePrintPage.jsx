import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import Printer from 'lucide-react/dist/esm/icons/printer.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePatient } from '@/features/patients/hooks/usePatientQueries';
import { usePatientEncounters } from '@/features/encounters/hooks/useEncounterQueries';
import { useChronicleContext } from '@/hooks/useChronicleContext';
import { fetchAllTimelineEntries, timelineKeys } from '@/hooks/useTimelineQueries';
import { useAuth } from '@/lib/auth';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { resolvePatientDisplayName } from '@/features/patients/utils/resolvePatientDisplayName';
import {
  CHRONICLE_ALL_VISITS,
  CHRONICLE_VISIT_PARAM,
  resolveChronicleVisitScope,
} from '@/features/patients/chronicle/visitScopeUtils';

const PRINT_PAGE_SIZE = 100;
const EMPTY_VALUE = 'Not recorded';
const NOTE_ENTRY_TYPES = new Set([
  'progress_note',
  'soap_note',
  'nursing_note',
  'admission_note',
  'discharge_note',
  'consult_note',
  'consult',
  'procedure',
]);
const NOTE_SECTION_ORDER = [
  'chief_complaint',
  'chiefComplaint',
  'subjective',
  'history_of_present_illness',
  'historyOfPresentIllness',
  'history',
  'objective',
  'physical_exam',
  'physicalExam',
  'examination',
  'assessment',
  'diagnosis',
  'plan',
  'treatment',
  'medications',
  'investigations',
  'results',
  'notes',
  'findings',
  'recommendations',
  'follow_up',
  'followUp',
];

function formatDateTime(value) {
  if (!value) return EMPTY_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(value) {
  if (!value) return EMPTY_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTimeRange(start, end) {
  const formattedStart = formatDateTime(start);
  if (formattedStart === EMPTY_VALUE) return EMPTY_VALUE;

  const formattedEnd = formatDateTime(end);
  if (formattedEnd === EMPTY_VALUE) return formattedStart;

  return `${formattedStart} to ${formattedEnd}`;
}

function titleize(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getPatientDetails(patient) {
  const local = patient?.local_data || patient || {};
  const user = local.user_details || patient?.user_details || patient?.patient_profile_details?.user_details || {};
  const mrn = local.medical_record_number || patient?.medical_record_number || patient?.mrn;
  const dob = user.date_of_birth || patient?.date_of_birth || patient?.fhir_data?.birthDate;
  const ward = local.current_ward || patient?.current_ward;
  const bed = local.current_bed || patient?.current_bed;

  return {
    name: resolvePatientDisplayName(patient) || 'Unknown Patient',
    mrn: mrn || EMPTY_VALUE,
    dateOfBirth: dob,
    gender: user.gender || patient?.gender || patient?.fhir_data?.gender || EMPTY_VALUE,
    phone: user.phone_number || user.phone || patient?.phone || EMPTY_VALUE,
    location: ward ? `${ward}${bed ? `, Bed ${bed}` : ''}` : EMPTY_VALUE,
  };
}

function normalizeTimelineEntryForPrint(entry) {
  if (entry?.entry_type === 'prescription') {
    return {
      ...entry,
      type: 'medication',
      data: {
        ...entry.data,
        name: entry.data?.medication_name || entry.data?.name,
        dose: entry.data?.dosage || entry.data?.dose,
        route: entry.data?.route_display || entry.data?.route,
        frequency: entry.data?.frequency_display || entry.data?.frequency,
        notes: entry.data?.instructions || entry.data?.notes,
      },
    };
  }

  if (entry?.entry_type === 'vitals' && entry.data) {
    return {
      ...entry,
      type: 'vitals',
      data: {
        temperature: entry.data.temperature,
        blood_pressure: entry.data.blood_pressure,
        heart_rate: entry.data.heart_rate,
        oxygen_saturation: entry.data.oxygen_saturation,
        respiratory_rate: entry.data.respiratory_rate,
        pain_level: entry.data.pain_level,
        notes: entry.data.notes,
      },
    };
  }

  return entry;
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return EMPTY_VALUE;
    return value.map(formatValue).join(', ');
  }
  if (typeof value === 'object') {
    const name = value.name || value.title || value.label || value.value || value.display;
    if (name) return String(name);
    return Object.entries(value)
      .filter(([, nestedValue]) => nestedValue !== null && nestedValue !== undefined && nestedValue !== '')
      .map(([key, nestedValue]) => `${titleize(key)}: ${formatValue(nestedValue)}`)
      .join('; ') || EMPTY_VALUE;
  }
  return String(value);
}

function shouldPrintDataKey(key) {
  const normalizedKey = String(key || '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();

  return ![
    'id',
    'uuid',
    'patient',
    'patient_id',
    'encounter',
    'encounter_id',
    'template',
    'template_id',
    'created_at',
    'updated_at',
    'author',
    'author_id',
    'patient_name',
    'template_name',
    'template_title',
    'template_system_key',
  ].includes(normalizedKey);
}

function getEntryTitle(entry) {
  if (entry.title) return entry.title;
  if (entry.data?.name) return entry.data.name;
  if (entry.data?.test_name) return entry.data.test_name;
  if (entry.data?.template_name) return entry.data.template_name;
  return titleize(entry.type || entry.entry_type || 'Chronicle entry');
}

function getEntrySummary(entry) {
  if (entry.content) return entry.content;
  if (entry.content_summary) return entry.content_summary;
  if (entry.data?.notes) return entry.data.notes;
  if (entry.data?.clinical_notes) return entry.data.clinical_notes;
  if (entry.data?.instructions) return entry.data.instructions;
  return '';
}

function compactValue(value) {
  const formatted = formatValue(value);
  return formatted === EMPTY_VALUE ? '' : formatted.trim();
}

function uniqueValues(values) {
  const seen = new Set();
  return values
    .map((value) => compactValue(value))
    .filter(Boolean)
    .filter((value) => {
      const normalized = value.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function isNoteEntry(entry) {
  return entry?.entry_type === 'note' || NOTE_ENTRY_TYPES.has(entry?.type);
}

function sortNoteSections(entries) {
  return [...entries].sort(([keyA], [keyB]) => {
    const indexA = NOTE_SECTION_ORDER.indexOf(keyA);
    const indexB = NOTE_SECTION_ORDER.indexOf(keyB);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return 0;
  });
}

function shouldPrintNoteSection(key, value, summary) {
  if (!shouldPrintDataKey(key)) return false;
  const formatted = compactValue(value);
  if (!formatted) return false;
  if (summary && formatted.toLowerCase() === summary.trim().toLowerCase()) return false;
  return true;
}

function getMedicationLine(entry) {
  const data = entry.data || {};
  return uniqueValues([
    data.dose || data.dosage,
    data.route_display || data.route,
    data.frequency_display || data.frequency,
    data.duration_days ? `for ${data.duration_days} days` : '',
    data.status_display || data.status,
  ]).join(' | ');
}

function getVitalsLine(entry) {
  const data = entry.data || {};
  return uniqueValues([
    data.blood_pressure && `BP ${data.blood_pressure}`,
    data.heart_rate && `HR ${data.heart_rate}`,
    data.temperature && `Temp ${data.temperature}`,
    data.oxygen_saturation && `SpO2 ${data.oxygen_saturation}`,
    data.respiratory_rate && `RR ${data.respiratory_rate}`,
    data.pain_level && `Pain ${data.pain_level}`,
  ]).join(' | ');
}

function getLabLine(entry) {
  const data = entry.data || {};
  const resultCount = Array.isArray(data.results) ? data.results.length : 0;
  const testCount = Array.isArray(data.tests_ordered) ? data.tests_ordered.length : 0;
  return uniqueValues([
    data.order_number,
    data.priority_display || data.priority,
    data.status_display || data.status,
    resultCount ? `${resultCount} result${resultCount === 1 ? '' : 's'}` : '',
    !resultCount && testCount ? `${testCount} test${testCount === 1 ? '' : 's'} ordered` : '',
  ]).join(' | ');
}

function field(label, value) {
  return [label, value];
}

function keepPrintableField([, value], summaryText = '') {
  const formatted = compactValue(value);
  return formatted && formatted.toLowerCase() !== summaryText.trim().toLowerCase();
}

function getSupportingFields(entry, summary) {
  const data = entry.data || {};
  const summaryText = summary || '';

  if (isNoteEntry(entry)) {
    return sortNoteSections(
      Object.entries(data).filter(([key, value]) => shouldPrintNoteSection(key, value, summaryText))
    );
  }

  if (entry.entry_type === 'prescription' || entry.type === 'medication' || entry.type === 'prescription') {
    return [
      field('Dose', data.dose || data.dosage),
      field('Route', data.route_display || data.route),
      field('Frequency', data.frequency_display || data.frequency),
      field('Duration', data.duration_days ? `${data.duration_days} days` : ''),
      field('Start date', data.start_date ? formatDate(data.start_date) : ''),
      field('End date', data.end_date ? formatDate(data.end_date) : ''),
      field('Status', data.status_display || data.status),
      field('Reason', data.reason),
      field('Instructions', data.instructions || data.notes),
      field('Discontinue reason', data.discontinue_reason),
    ].filter((item) => keepPrintableField(item, summaryText));
  }

  if (entry.entry_type === 'vitals' || entry.type === 'vitals') {
    return [
      field('Blood pressure', data.blood_pressure),
      field('Heart rate', data.heart_rate),
      field('Temperature', data.temperature),
      field('Oxygen saturation', data.oxygen_saturation),
      field('Respiratory rate', data.respiratory_rate),
      field('Pain level', data.pain_level),
      field('Notes', data.notes),
    ].filter((item) => keepPrintableField(item, summaryText));
  }

  if (entry.entry_type === 'lab_result' || entry.type === 'lab_result') {
    return [
      field('Order number', data.order_number),
      field('Priority', data.priority_display || data.priority),
      field('Status', data.status_display || data.status),
      field('Ordered at', data.ordered_at ? formatDateTime(data.ordered_at) : ''),
      field('Completed at', data.completed_at ? formatDateTime(data.completed_at) : ''),
      field('Clinical notes', data.clinical_notes),
      field('Results summary', data.results_summary),
      field('Tests ordered', data.tests_ordered),
      field('Results', data.results),
      field('Tests', data.tests),
    ].filter((item) => keepPrintableField(item, summaryText));
  }

  if (entry.entry_type === 'referral' || entry.type === 'referral') {
    return [
      field('Referral number', data.referral_number),
      field('Status', data.status_display || data.status),
      field('Urgency', data.urgency_display || data.urgency),
      field('Referring department', data.referring_department),
      field('Referred to specialty', data.referred_to_specialty),
      field('Referred to department', data.referred_to_department),
      field('Referred to provider', data.referred_to_provider),
      field('Reason', data.reason),
      field('Clinical summary', data.clinical_summary),
      field('Question', data.questions_for_specialist),
      field('Specialist notes', data.specialist_notes),
      field('Recommendations', data.recommendations),
    ].filter((item) => keepPrintableField(item, summaryText));
  }

  if (entry.entry_type === 'chart' || entry.type === 'chart') {
    return [
      field('Template', data.template_name),
      field('Scope', data.scope_type),
      field('Notes', data.notes),
    ].filter((item) => keepPrintableField(item, summaryText));
  }

  return Object.entries(data)
    .filter(([key, value]) => shouldPrintDataKey(key) && compactValue(value));
}

function getEntryLeadLine(entry) {
  if (entry.entry_type === 'prescription' || entry.type === 'medication' || entry.type === 'prescription') {
    return getMedicationLine(entry);
  }
  if (entry.entry_type === 'vitals' || entry.type === 'vitals') {
    return getVitalsLine(entry);
  }
  if (entry.entry_type === 'lab_result' || entry.type === 'lab_result') {
    return getLabLine(entry);
  }
  return '';
}

function groupEntriesByEncounter(entries, encounters) {
  const encounterMap = new Map((encounters || []).map((encounter) => [String(encounter.id), encounter]));
  const grouped = [];
  const unlinked = [];
  const groupedMap = new Map();

  entries.forEach((entry) => {
    const encounterId = entry.encounter_id || entry.encounter?.id;
    if (!encounterId) {
      unlinked.push(entry);
      return;
    }

    const key = String(encounterId);
    if (!groupedMap.has(key)) {
      groupedMap.set(key, []);
    }
    groupedMap.get(key).push(entry);
  });

  groupedMap.forEach((groupEntries, encounterId) => {
    const encounter = encounterMap.get(encounterId) || groupEntries[0]?.encounter || { id: encounterId };
    grouped.push({
      encounter,
      entries: [...groupEntries].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    });
  });

  grouped.sort((a, b) => {
    const dateA = new Date(a.encounter?.start_time || a.entries[0]?.timestamp || 0);
    const dateB = new Date(b.encounter?.start_time || b.entries[0]?.timestamp || 0);
    return dateB - dateA;
  });

  return { grouped, unlinked };
}

function SupportingFields({ fields, isNote }) {
  if (fields.length === 0) return null;

  return (
    <dl className="print-entry-data mt-2 space-y-1.5">
      {fields.map(([key, value]) => (
        <div
          key={key}
          className={isNote ? 'print-note-section border-l-2 border-neutral-400 pl-3' : 'grid grid-cols-[7.5rem_1fr] gap-2 border-t border-neutral-300 pt-1.5'}
        >
          <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-neutral-500">
            {titleize(key)}
          </dt>
          <dd className="whitespace-pre-wrap text-[12px] leading-5 text-neutral-900">
            {formatValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PrintEntry({ entry }) {
  const summary = getEntrySummary(entry);
  const leadLine = getEntryLeadLine(entry);
  const isNote = isNoteEntry(entry);
  const supportingFields = getSupportingFields(entry, summary);

  return (
    <article className="print-entry border-t border-neutral-200 py-3 first:border-t-0">
      <div className="grid gap-2 sm:grid-cols-[8.5rem_1fr_9rem]">
        <div className="font-mono text-[10px] leading-5 text-neutral-600">
          <time>{formatDateTime(entry.timestamp)}</time>
          {entry.author && <div className="text-neutral-500">{entry.author}</div>}
        </div>
        <div>
          <h4 className="text-[14px] font-semibold leading-5 text-neutral-950">
            {getEntryTitle(entry)}
          </h4>
          {leadLine && (
            <p className="mt-1 font-mono text-[11px] leading-5 text-neutral-700">
              {leadLine}
            </p>
          )}
          {summary && (
            <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-neutral-800">
              {summary}
            </p>
          )}
          <SupportingFields fields={supportingFields} isNote={isNote} />
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500 sm:text-right">
          {titleize(entry.type || entry.entry_type)}
        </div>
      </div>
    </article>
  );
}

function EncounterSection({ encounter, entries }) {
  const encounterType = encounter?.encounter_type || encounter?.type || 'Encounter';
  const practitioner = encounter?.practitioner_name || encounter?.provider_name;
  const location = encounter?.location || encounter?.department_name || encounter?.ward_name;

  return (
    <section className="print-section print-box border border-neutral-400 bg-white">
      <header className="print-section-header border-b border-neutral-300 py-2">
        <div className="grid gap-3 px-3 sm:grid-cols-[1fr_14rem]">
          <div>
            <h3 className="text-[14px] font-semibold leading-5 text-neutral-950">{titleize(encounterType)}</h3>
            <p className="font-mono text-[10px] text-neutral-600">
              {formatDateTimeRange(encounter?.start_time, encounter?.end_time)}
            </p>
          </div>
          <div className="font-mono text-[10px] leading-5 text-neutral-600 sm:text-right">
            {encounter?.status && <div>{titleize(encounter.status)}</div>}
            {practitioner && <div>{practitioner}</div>}
            {location && <div>{location}</div>}
          </div>
        </div>
      </header>
      <div className="px-3">
        {entries.map((entry) => (
          <PrintEntry key={`${entry.type}-${entry.id || entry.timestamp}`} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function SummaryList({ title, items, getLabel }) {
  return (
    <section className="print-box break-inside-avoid border border-neutral-400">
      <h3 className="border-b border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-600">
        {title}
      </h3>
      {items.length > 0 ? (
        <ul className="space-y-1.5 px-3 py-2 text-[12px] leading-5 text-neutral-900">
          {items.map((item, index) => (
            <li key={item.id || index}>{getLabel(item)}</li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-2 text-[12px] text-neutral-500">{EMPTY_VALUE}</p>
      )}
    </section>
  );
}

export default function PatientChroniclePrintPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const hasPrintedRef = useRef(false);
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedVisit = params.get(CHRONICLE_VISIT_PARAM);
  const requestedType = params.get('type') || 'all';
  const requestedSearch = params.get('search') || '';

  const { data: patient, isLoading: isPatientLoading, error: patientError } = usePatient(id);
  const patientLocalId = patient?.local_data?.id || patient?.id || id;
  const { data: chronicleContext, isLoading: isContextLoading, error: contextError } = useChronicleContext(id, {
    enabled: !!id && !isPatientLoading,
  });
  const { data: encounters = [], isLoading: areEncountersLoading } = usePatientEncounters(patientLocalId, {
    enabled: !!patientLocalId && !isPatientLoading,
  });
  const activeEncounter = chronicleContext?.active_encounter;
  const resolvedVisitScope = resolveChronicleVisitScope({
    requestedVisit,
    activeEncounterId: activeEncounter?.id,
    encounters,
    areEncountersLoading,
  });
  const encounterId = resolvedVisitScope && resolvedVisitScope !== CHRONICLE_ALL_VISITS
    ? resolvedVisitScope
    : undefined;

  const timelineQuery = useQuery({
    queryKey: [
      ...timelineKeys.listParams(id, requestedType, requestedSearch, PRINT_PAGE_SIZE, undefined, undefined, encounterId),
      'print',
    ],
    queryFn: ({ signal }) => fetchAllTimelineEntries(id, {
      type: requestedType,
      search: requestedSearch,
      encounter_id: encounterId,
      page_size: PRINT_PAGE_SIZE,
    }, { signal }),
    enabled: !!id && !!resolvedVisitScope && !isPatientLoading && !isContextLoading,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const patientDetails = useMemo(() => getPatientDetails(patient), [patient]);
  const pageMeta = usePageMeta({
    title: `${patientDetails.name} Chronicle Print | Hospital Management System`,
  });
  const entries = useMemo(() => (
    (timelineQuery.data?.results || []).map(normalizeTimelineEntryForPrint)
  ), [timelineQuery.data]);
  const groupedEntries = useMemo(() => groupEntriesByEncounter(entries, encounters), [entries, encounters]);
  const visitScopeLabel = useMemo(() => {
    if (resolvedVisitScope === CHRONICLE_ALL_VISITS) {
      return 'All history';
    }

    const selectedEncounter = encounters.find((encounter) => String(encounter.id) === String(resolvedVisitScope))
      || activeEncounter;
    const range = formatDateTimeRange(selectedEncounter?.start_time, selectedEncounter?.end_time);

    return range === EMPTY_VALUE ? 'Selected visit' : range;
  }, [activeEncounter, encounters, resolvedVisitScope]);
  const allergies = chronicleContext?.allergies || [];
  const medications = chronicleContext?.active_medications || [];
  const latestVitals = chronicleContext?.latest_vitals ? [chronicleContext.latest_vitals] : [];
  const isLoading = isPatientLoading || isContextLoading || areEncountersLoading || timelineQuery.isLoading;
  const error = patientError || contextError || timelineQuery.error;

  useEffect(() => {
    if (hasPrintedRef.current || isLoading || error) {
      return;
    }

    hasPrintedRef.current = true;
    const timer = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timer);
  }, [error, isLoading]);

  return (
    <>
      {pageMeta}
      <style>{`
        @page {
          margin: 11mm 12mm;
          size: A4;
        }
        .print-document {
          font-size: 12px;
          line-height: 1.45;
        }
        .print-box {
          box-shadow: inset 0 0 0 1px #a3a3a3;
        }
        .print-note-section {
          box-shadow: inset 2px 0 0 #a3a3a3;
        }
        @media print {
          html {
            background: white !important;
          }
          body {
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
          .print-document {
            margin: 0 !important;
            max-width: none !important;
            box-shadow: none !important;
          }
          .print-box {
            box-shadow: inset 0 0 0 1px #737373 !important;
          }
          .print-note-section {
            border-left: 0 !important;
            box-shadow: inset 2px 0 0 #737373 !important;
          }
          .print-entry-data,
          .print-section-header {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
      <div className="min-h-screen bg-neutral-100 py-6 text-neutral-950 print:bg-white print:py-0">
        <div className="no-print mx-auto mb-4 flex max-w-5xl items-center justify-between px-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="font-mono text-xs">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button size="sm" onClick={() => window.print()} disabled={isLoading || !!error} className="font-mono text-xs">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>

        <main className="print-document mx-auto max-w-5xl bg-white p-7 shadow-sm print:p-0">
          {isLoading ? (
            <div className="space-y-6">
              <Skeleton className="h-16 w-2/3" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : error ? (
            <section className="rounded border border-rose-300 bg-rose-50 p-6 text-rose-900">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5" />
                <div>
                  <h1 className="text-lg font-semibold">Unable to prepare Chronicle printout</h1>
                  <p className="mt-2 text-sm">{error.message || 'Please refresh and try again.'}</p>
                  <Button variant="outline" size="sm" className="mt-4 font-mono text-xs" onClick={() => timelineQuery.refetch()}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                  </Button>
                </div>
              </div>
            </section>
          ) : (
            <article className="space-y-5">
              <header className="border-b-2 border-neutral-950 pb-4">
                <div className="grid gap-5 sm:grid-cols-[1fr_18rem]">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                      Patient Chronicle
                    </p>
                    <h1 className="mt-1 text-3xl font-semibold leading-tight tracking-tight text-neutral-950">
                      {patientDetails.name}
                    </h1>
                  </div>
                  <div className="font-mono text-[11px] leading-5 text-neutral-600 sm:text-right">
                    <div>Printed {formatDateTime(new Date())}</div>
                    <div>Printed by {user?.full_name || user?.username || user?.email || EMPTY_VALUE}</div>
                    <div>{visitScopeLabel}</div>
                  </div>
                </div>

                <dl className="print-box mt-4 grid grid-cols-2 border border-neutral-400 text-[12px] sm:grid-cols-4">
                  <div>
                    <dt className="border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-neutral-500">MRN</dt>
                    <dd className="px-3 py-2 font-mono">{patientDetails.mrn}</dd>
                  </div>
                  <div className="border-l border-neutral-200">
                    <dt className="border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-neutral-500">DOB</dt>
                    <dd className="px-3 py-2">{formatDate(patientDetails.dateOfBirth)}</dd>
                  </div>
                  <div className="border-l border-neutral-200">
                    <dt className="border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-neutral-500">Sex</dt>
                    <dd className="px-3 py-2">{titleize(patientDetails.gender)}</dd>
                  </div>
                  <div className="border-l border-neutral-200">
                    <dt className="border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-neutral-500">Location</dt>
                    <dd className="px-3 py-2">{patientDetails.location}</dd>
                  </div>
                </dl>
              </header>

              <section className="grid gap-3 md:grid-cols-3">
                <SummaryList
                  title="Allergies"
                  items={allergies}
                  getLabel={(item) => formatValue(item)}
                />
                <SummaryList
                  title="Active Medications"
                  items={medications}
                  getLabel={(item) => [
                    item.name || item.medication_name,
                    item.dose || item.dosage,
                    item.frequency || item.frequency_display,
                  ].filter(Boolean).join(' ') || EMPTY_VALUE}
                />
                <SummaryList
                  title="Recent Vitals"
                  items={latestVitals}
                  getLabel={(item) => [
                    item.blood_pressure && `BP ${item.blood_pressure}`,
                    item.heart_rate && `HR ${item.heart_rate}`,
                    item.temperature && `Temp ${item.temperature}`,
                    item.oxygen_saturation && `SpO2 ${item.oxygen_saturation}`,
                  ].filter(Boolean).join(' | ') || EMPTY_VALUE}
                />
              </section>

              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-300 pb-2">
                  <div>
                    <h2 className="text-lg font-semibold leading-tight text-neutral-950">Timeline</h2>
                    <p className="mt-0.5 font-mono text-[10px] text-neutral-600">
                      {timelineQuery.data?.count ?? entries.length} entries
                      {requestedType !== 'all' ? ` | ${titleize(requestedType)}` : ''}
                      {requestedSearch ? ` | Search: ${requestedSearch}` : ''}
                    </p>
                  </div>
                </div>

                {groupedEntries.grouped.length === 0 && groupedEntries.unlinked.length === 0 ? (
                  <p className="text-sm text-neutral-500">No chronicle entries found for this print scope.</p>
                ) : (
                  <div className="space-y-4">
                    {groupedEntries.grouped.map(({ encounter, entries: encounterEntries }) => (
                      <EncounterSection
                        key={encounter.id || encounterEntries[0]?.timestamp}
                        encounter={encounter}
                        entries={encounterEntries}
                      />
                    ))}
                    {groupedEntries.unlinked.length > 0 && (
                      <EncounterSection
                        encounter={{ id: 'unlinked', encounter_type: 'Unlinked entries' }}
                        entries={groupedEntries.unlinked}
                      />
                    )}
                  </div>
                )}
              </section>
            </article>
          )}
        </main>
      </div>
    </>
  );
}
