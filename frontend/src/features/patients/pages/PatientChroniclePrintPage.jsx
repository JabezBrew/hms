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

function titleize(value) {
  return String(value || '')
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
  ].includes(key);
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

function DataRows({ data }) {
  if (!data || typeof data !== 'object') return null;

  const rows = Object.entries(data)
    .filter(([key, value]) => shouldPrintDataKey(key) && value !== null && value !== undefined && value !== '');

  if (rows.length === 0) return null;

  return (
    <dl className="print-entry-data mt-2 grid grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2">
      {rows.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[7.5rem_1fr] gap-2 border-t border-neutral-200 pt-1.5">
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
          {summary && (
            <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-neutral-800">
              {summary}
            </p>
          )}
          <DataRows data={entry.data} />
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
    <section className="print-section border-t-2 border-neutral-900">
      <header className="print-section-header border-b border-neutral-300 py-2">
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
          <div>
            <h3 className="text-[14px] font-semibold leading-5 text-neutral-950">{titleize(encounterType)}</h3>
            <p className="font-mono text-[10px] text-neutral-600">
              {formatDate(encounter?.start_time)}
              {encounter?.end_time ? ` to ${formatDate(encounter.end_time)}` : ''}
            </p>
          </div>
          <div className="font-mono text-[10px] leading-5 text-neutral-600 sm:text-right">
            {encounter?.status && <div>{titleize(encounter.status)}</div>}
            {practitioner && <div>{practitioner}</div>}
            {location && <div>{location}</div>}
          </div>
        </div>
      </header>
      <div>
        {entries.map((entry) => (
          <PrintEntry key={`${entry.type}-${entry.id || entry.timestamp}`} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function SummaryList({ title, items, getLabel }) {
  return (
    <section className="break-inside-avoid border border-neutral-300">
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
                    <div>{resolvedVisitScope === CHRONICLE_ALL_VISITS ? 'All history' : 'Selected visit'}</div>
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-2 border border-neutral-300 text-[12px] sm:grid-cols-4">
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
