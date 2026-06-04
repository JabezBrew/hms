import { useMemo } from "react";

import { normalizeExpansionId } from "@/components/chronicle/chronicleNoteUtils";
import { getEncounterKind } from "@/features/patients/chronicle/chronicleEncounterUtils";
import { flattenTimelinePages, getTimelineTotalCount } from "@/hooks/useTimelineQueries";

function hasDisplayValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

export function getEntryTimestamp(entry) {
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

export function formatEncounterDateRange(encounter, fallbackTimestamp = null) {
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

export function getEncounterTitle(encounter) {
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

export function formatEncounterScopeLabel(encounter, activeEncounterId) {
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
    'doctor_note',
    'progress_note',
    'soap_note',
    'admission_note',
    'discharge_note',
    'consult_note',
    'consultation_note',
    'nursing_note',
    'allied_health_note',
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

export function useChronicleTimelineState({
  hasNextPage,
  isFetchingNextPage,
  isTimelineLoading,
  isVisitScopePending,
}) {
  return useMemo(() => ({
    hasNextPage,
    isFetchingNextPage,
    isTimelineLoading,
    isVisitScopePending,
  }), [hasNextPage, isFetchingNextPage, isTimelineLoading, isVisitScopePending]);
}

export function useChronicleTimelineViewModel({
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
        entry.type === 'doctor_note' ||
        entry.type === 'soap_note' ||
        entry.type === 'admission_note' ||
        entry.type === 'discharge_note' ||
        entry.type === 'consult_note' ||
        entry.type === 'nursing_note' ||
        entry.type === 'allied_health_note'
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

    const normalizedActiveEncounterId = normalizeExpansionId(activeEncounter?.id);
    groups.encounters.sort((a, b) => {
      const aIsActive = normalizeExpansionId(a.encounter?.id) === normalizedActiveEncounterId;
      const bIsActive = normalizeExpansionId(b.encounter?.id) === normalizedActiveEncounterId;
      if (aIsActive !== bIsActive) {
        return aIsActive ? -1 : 1;
      }

      const dateA = toTimestampMs(a.encounter.start_time || getEntryTimestamp(a.entries[0])) || 0;
      const dateB = toTimestampMs(b.encounter.start_time || getEntryTimestamp(b.entries[0])) || 0;
      return dateB - dateA;
    });

    groups.unlinked = sortEntriesByTimestampDesc(groups.unlinked);

    return groups;
  }, [activeEncounter?.id, filteredEntries, encounters]);

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
