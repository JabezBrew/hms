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
  // Track selectedEntryId in a ref so the effect can read it without depending on it
  const selectedEntryIdRef = useRef(selectedEntryId);
  selectedEntryIdRef.current = selectedEntryId;

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

  // Handle auto-select and re-select when visibleEntries change.
  // Uses ref for selectedEntryId to avoid re-triggering on selection changes.
  useEffect(() => {
    if (visibleEntries.length === 0) return;

    // Initial auto-select: pick first entry on first data load
    if (!hasAutoSelected.current) {
      setSelectedEntryId(String(visibleEntries[0].id));
      hasAutoSelected.current = true;
      return;
    }

    // Re-select: if current selection is no longer visible, pick first visible entry
    const currentId = selectedEntryIdRef.current;
    if (currentId) {
      const stillVisible = visibleEntries.some(
        (e) => String(e.id) === String(currentId)
      );
      if (!stillVisible) {
        setSelectedEntryId(String(visibleEntries[0].id));
      }
    }
  }, [visibleEntries]);

  // Select an entry by ID. Uses functional updater for setExpandedEncounters
  // to avoid needing expandedEncounters in the dependency array.
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
          if (hasEntry) {
            setExpandedEncounters((prev) => {
              if (prev.has(encId)) return prev;
              const next = new Set(prev);
              next.add(encId);
              return next;
            });
            break;
          }
        }
      }
    },
    [groupedByEncounter, setExpandedEncounters]
  );

  const clearSelection = useCallback(() => {
    setSelectedEntryId(null);
  }, []);

  // Navigate to next/previous visible entry
  const selectNext = useCallback(() => {
    if (visibleEntries.length === 0) return;
    const currentIndex = visibleEntries.findIndex(
      (e) => String(e.id) === String(selectedEntryIdRef.current)
    );
    const nextIndex =
      currentIndex < 0 ? 0 : Math.min(currentIndex + 1, visibleEntries.length - 1);
    setSelectedEntryId(String(visibleEntries[nextIndex].id));
  }, [visibleEntries]);

  const selectPrevious = useCallback(() => {
    if (visibleEntries.length === 0) return;
    const currentIndex = visibleEntries.findIndex(
      (e) => String(e.id) === String(selectedEntryIdRef.current)
    );
    const prevIndex = currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0);
    setSelectedEntryId(String(visibleEntries[prevIndex].id));
  }, [visibleEntries]);

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
