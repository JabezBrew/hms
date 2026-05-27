import { useCallback, useEffect, useRef, useState } from "react";

import {
  getInitialExpandedEncounterIds,
  getInitialExpandedNoteIds,
  normalizeExpansionId,
  shouldDeferEncounterExpansionSeed,
} from "@/components/chronicle/chronicleNoteUtils";

export function useChronicleTimelineExpansion({
  activeEncounterId,
  activeFilter,
  areEncountersLoading,
  debouncedSearch,
  filteredEntries,
  groupedByEncounter,
  hasNextPage,
  isTimelineLoading,
  patientId,
  resolvedVisitScope,
}) {
  const encounterExpansionSeedRef = useRef(null);
  const noteExpansionSeedRef = useRef(null);
  const [expandedEncounters, setExpandedEncounters] = useState(() => new Set());
  const [expandedNoteIds, setExpandedNoteIds] = useState(() => new Set());

  const expansionSeedKey = `${patientId}:${resolvedVisitScope || 'pending'}:${activeFilter}:${(debouncedSearch || '').trim().toLowerCase()}`;

  const encounterGroups = groupedByEncounter.encounters;
  const unlinkedEntries = groupedByEncounter.unlinked;
  const encounterGroupCount = encounterGroups.length;
  const unlinkedEntryCount = unlinkedEntries.length;

  useEffect(() => {
    if (encounterGroupCount > 0 && areEncountersLoading) {
      return;
    }
    if (encounterGroupCount === 0 && unlinkedEntryCount === 0) {
      return;
    }
    if (shouldDeferEncounterExpansionSeed({
      encounters: encounterGroups,
      activeEncounterId,
      areEncountersLoading,
      isTimelineLoading,
      hasNextPage,
    })) {
      return;
    }
    if (encounterExpansionSeedRef.current === expansionSeedKey) {
      return;
    }

    // oxlint-disable-next-line react-doctor/no-derived-state -- Expansion is user-controlled UI state seeded once per patient/visit/filter key; recomputing each render would erase manual toggles.
    setExpandedEncounters(getInitialExpandedEncounterIds({
      encounters: encounterGroups,
      unlinkedEntries,
      activeEncounterId,
    }));
    encounterExpansionSeedRef.current = expansionSeedKey;
  }, [
    activeEncounterId,
    areEncountersLoading,
    encounterGroupCount,
    encounterGroups,
    expansionSeedKey,
    hasNextPage,
    isTimelineLoading,
    unlinkedEntries,
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

  const toggleEncounter = useCallback((encounterId) => {
    const normalizedEncounterId = normalizeExpansionId(encounterId);
    if (!normalizedEncounterId) {
      return;
    }

    setExpandedEncounters((previous) => {
      const next = new Set(previous);
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

  const expandAll = useCallback(() => {
    const allIds = new Set();
    if (unlinkedEntries.length > 0) {
      allIds.add('unlinked');
    }
    encounterGroups.forEach((group) => {
      const normalizedEncounterId = normalizeExpansionId(group.encounter?.id);
      if (normalizedEncounterId) {
        allIds.add(normalizedEncounterId);
      }
    });
    setExpandedEncounters(allIds);
  }, [encounterGroups, unlinkedEntries]);

  const collapseAll = useCallback(() => {
    setExpandedEncounters(new Set());
  }, []);

  return {
    collapseAll,
    expandAll,
    expandedEncounters,
    expandedNoteIds,
    toggleEncounter,
    toggleNoteExpanded,
  };
}
