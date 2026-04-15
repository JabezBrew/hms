import { useState, useMemo, useCallback, useEffect, useRef } from 'react';

/**
 * Manages entry selection state for the Chronicle master-detail view.
 *
 * Auto-selects the first entry of the first expanded encounter on mount
 * and when filters/data change (only if the current selection is no longer visible).
 */
export function useTimelineSelection({
  groupedByEncounter,
  expandedEncounters,
  setExpandedEncounters,
}) {
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const hasAutoSelected = useRef(false);

  // Build a flat list of all visible (expanded) entries for navigation
  const visibleEntries = useMemo(() => {
    if (!groupedByEncounter) return [];
    const entries = [];

    for (const group of groupedByEncounter.encounters || []) {
      const encId = String(group.encounter?.id ?? '');
      if (expandedEncounters.has(encId)) {
        for (const entry of group.entries) {
          entries.push(entry);
        }
      }
    }

    // Unlinked entries
    if (expandedEncounters.has('unlinked')) {
      for (const entry of groupedByEncounter.unlinked || []) {
        entries.push(entry);
      }
    }

    return entries;
  }, [groupedByEncounter, expandedEncounters]);

  // Resolve the full entry object from the ID
  const selectedEntry = useMemo(() => {
    if (!selectedEntryId) return null;
    return visibleEntries.find((e) => String(e.id) === String(selectedEntryId)) || null;
  }, [selectedEntryId, visibleEntries]);

  // Auto-select first entry on initial data load
  useEffect(() => {
    if (hasAutoSelected.current) return;
    if (visibleEntries.length > 0) {
      setSelectedEntryId(String(visibleEntries[0].id));
      hasAutoSelected.current = true;
    }
  }, [visibleEntries]);

  // If the selected entry disappears from visible entries (filter change, etc.),
  // re-select the first visible entry
  useEffect(() => {
    if (!selectedEntryId) return;
    const stillVisible = visibleEntries.some(
      (e) => String(e.id) === String(selectedEntryId)
    );
    if (!stillVisible && visibleEntries.length > 0) {
      setSelectedEntryId(String(visibleEntries[0].id));
    }
  }, [selectedEntryId, visibleEntries]);

  const selectEntry = useCallback(
    (entryId) => {
      setSelectedEntryId(String(entryId));

      // Auto-expand the parent encounter if it's collapsed
      if (groupedByEncounter && setExpandedEncounters) {
        for (const group of groupedByEncounter.encounters || []) {
          const encId = String(group.encounter?.id ?? '');
          const hasEntry = group.entries.some(
            (e) => String(e.id) === String(entryId)
          );
          if (hasEntry && !expandedEncounters.has(encId)) {
            setExpandedEncounters((prev) => {
              const next = new Set(prev);
              next.add(encId);
              return next;
            });
            break;
          }
        }
      }
    },
    [groupedByEncounter, expandedEncounters, setExpandedEncounters]
  );

  const clearSelection = useCallback(() => {
    setSelectedEntryId(null);
  }, []);

  // Navigate to next/previous visible entry
  const selectNext = useCallback(() => {
    if (visibleEntries.length === 0) return;
    const currentIndex = visibleEntries.findIndex(
      (e) => String(e.id) === String(selectedEntryId)
    );
    const nextIndex =
      currentIndex < 0 ? 0 : Math.min(currentIndex + 1, visibleEntries.length - 1);
    setSelectedEntryId(String(visibleEntries[nextIndex].id));
  }, [selectedEntryId, visibleEntries]);

  const selectPrevious = useCallback(() => {
    if (visibleEntries.length === 0) return;
    const currentIndex = visibleEntries.findIndex(
      (e) => String(e.id) === String(selectedEntryId)
    );
    const prevIndex = currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0);
    setSelectedEntryId(String(visibleEntries[prevIndex].id));
  }, [selectedEntryId, visibleEntries]);

  return {
    selectedEntryId,
    selectedEntry,
    selectEntry,
    clearSelection,
    selectNext,
    selectPrevious,
    visibleEntries,
  };
}
