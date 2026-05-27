const INLINE_EXPANDABLE_NOTE_TYPES = new Set([
  'progress_note',
  'soap_note',
  'nursing_note',
  'admission_note',
  'discharge_note',
  'consult_note',
  'consult',
  'procedure',
]);

const normalizeExpansionId = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
};

const hasStructuredDetail = (data) => (
  Boolean(data)
  && typeof data === 'object'
  && !Array.isArray(data)
  && Object.keys(data).length > 0
);

const hasLongTextDetail = (content) => (
  typeof content === 'string'
  && content.trim().length > 150
);

export const hasEntryDetailContent = (entry) => {
  if (!entry) {
    return false;
  }

  if (hasStructuredDetail(entry.data)) {
    return true;
  }

  return hasLongTextDetail(entry.content);
};

export const isInlineExpandableNoteEntry = (entry) => (
  INLINE_EXPANDABLE_NOTE_TYPES.has(entry?.type)
  && hasEntryDetailContent(entry)
);

export const getInitialExpandedEncounterIds = ({
  encounters = [],
  unlinkedEntries = [],
  activeEncounterId = null,
}) => {
  const expandedIds = new Set();
  const normalizedActiveEncounterId = normalizeExpansionId(activeEncounterId);

  if (encounters.length === 0) {
    if (unlinkedEntries.length > 0) {
      expandedIds.add('unlinked');
    }
    return expandedIds;
  }

  const activeEncounterGroup = normalizedActiveEncounterId
    ? encounters.find(({ encounter }) => normalizeExpansionId(encounter?.id) === normalizedActiveEncounterId)
    : null;

  const encounterToExpand = activeEncounterGroup || encounters[0];
  const normalizedEncounterId = normalizeExpansionId(encounterToExpand?.encounter?.id);

  if (normalizedEncounterId) {
    expandedIds.add(normalizedEncounterId);
  }

  return expandedIds;
};

export const shouldDeferEncounterExpansionSeed = ({
  encounters = [],
  activeEncounterId = null,
  areEncountersLoading = false,
  isTimelineLoading = false,
  hasNextPage = false,
} = {}) => {
  const normalizedActiveEncounterId = normalizeExpansionId(activeEncounterId);
  if (!normalizedActiveEncounterId) {
    return false;
  }

  const hasActiveEncounterGroup = encounters.some(({ encounter }) => (
    normalizeExpansionId(encounter?.id) === normalizedActiveEncounterId
  ));

  return !hasActiveEncounterGroup && (areEncountersLoading || isTimelineLoading || hasNextPage);
};

export const getInitialExpandedNoteIds = ({
  entries = [],
  activeFilter = 'all',
}) => {
  const expandedIds = new Set();
  const autoExpandLimit = activeFilter === 'progress_note' ? 2 : 1;

  for (const entry of entries) {
    if (expandedIds.size >= autoExpandLimit) {
      break;
    }

    const normalizedId = normalizeExpansionId(entry?.id);
    if (!normalizedId || !isInlineExpandableNoteEntry(entry)) {
      continue;
    }

    expandedIds.add(normalizedId);
  }

  return expandedIds;
};

export {
  INLINE_EXPANDABLE_NOTE_TYPES,
  normalizeExpansionId,
};
