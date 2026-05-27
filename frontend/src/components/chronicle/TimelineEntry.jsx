import { useEffect, useRef, useState } from 'react';

import {
  LabResultContent,
  MedicationContent,
  NotePreview,
  ReferralContent,
  TimelineEntryContent,
  VitalsContent,
} from './TimelineEntryContent';
import TimelineEntryFrame from './TimelineEntryFrame';
import {
  hasEntryDetailContent,
  isInlineExpandableNoteEntry,
  normalizeExpansionId,
} from './chronicleNoteUtils';
import {
  buildCopyNoteEntry,
  buildEditNotePayload,
  getTimelineEntryConfig,
  getTimelineEntryTimestamp,
  isCopyableTimelineNote,
  isEditableTimelineNote,
} from './timelineEntryFrameUtils';

/**
 * TimelineEntry - A chronological entry in the patient's clinical chronicle.
 *
 * The frame owns note actions and expansion state; type-specific clinical
 * rendering is delegated to TimelineEntryContent so each display contract stays
 * reviewable in isolation.
 */
const TimelineEntry = ({
  entry,
  index = 0,
  isRecent = false,
  className,
  currentUserId,
  onCopyNote,
  onEditNote,
  onNoteUpdated,
  isNoteExpanded,
  onToggleNoteExpanded,
}) => {
  const [isFallbackNoteExpanded, setIsFallbackNoteExpanded] = useState(false);

  const hasAnimatedRef = useRef(false);
  useEffect(() => { hasAnimatedRef.current = true; }, []);

  const config = getTimelineEntryConfig(entry.type);
  const entryTimestamp = getTimelineEntryTimestamp(entry);
  const hasDetailContent = hasEntryDetailContent(entry);
  const canInlineExpand = isInlineExpandableNoteEntry(entry);
  const noteBodyId = normalizeExpansionId(entry?.id)
    ? `chronicle-note-body-${normalizeExpansionId(entry.id)}`
    : undefined;
  const noteExpanded = typeof isNoteExpanded === 'boolean'
    ? isNoteExpanded
    : isFallbackNoteExpanded;
  const canCopyNote = isCopyableTimelineNote(entry);
  const canEditNote = Boolean(onEditNote) && isEditableTimelineNote(entry, currentUserId);
  const actionCapabilities = {
    canCopyNote,
    canEditNote,
    canInlineExpand,
    hasDetailContent,
  };
  const copyNoteEntry = canCopyNote ? buildCopyNoteEntry(entry, config.label) : null;

  const handleEditClick = () => {
    if (!onEditNote) return;

    onEditNote(buildEditNotePayload(entry));
  };

  const handleToggleNoteExpanded = () => {
    if (!canInlineExpand) {
      return;
    }

    if (onToggleNoteExpanded && entry?.id !== null && entry?.id !== undefined) {
      onToggleNoteExpanded(entry.id);
      return;
    }

    setIsFallbackNoteExpanded((previous) => !previous);
  };

  return (
    <TimelineEntryFrame
      capabilities={actionCapabilities}
      className={className}
      config={config}
      copyNoteEntry={copyNoteEntry}
      currentUserId={currentUserId}
      entry={entry}
      entryTimestamp={entryTimestamp}
      hasAnimated={hasAnimatedRef.current}
      index={index}
      isRecent={isRecent}
      noteBodyId={noteBodyId}
      noteExpanded={noteExpanded}
      onCopyNote={onCopyNote}
      onEditClick={handleEditClick}
      onEditNote={onEditNote}
      onNoteUpdated={onNoteUpdated}
      onToggleNoteExpanded={handleToggleNoteExpanded}
    >
      <TimelineEntryContent
        canInlineExpand={canInlineExpand}
        entry={entry}
        noteBodyId={noteBodyId}
        noteExpanded={noteExpanded}
      />
    </TimelineEntryFrame>
  );
};

/**
 * TimelineGroup - Groups timeline entries by date.
 */
const TimelineGroup = ({ date, entries, startIndex = 0 }) => {
  return (
    <div className="mb-8 last:mb-0">
      <div className="flex items-center gap-4 mb-4 ml-8">
        <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {date}
        </h3>
        <div className="flex-1 h-px bg-gradient-to-r from-border to-transparent" />
      </div>

      <div>
        {entries.map((entry, i) => (
          <TimelineEntry
            key={entry.id || `entry-${startIndex + i}`}
            entry={entry}
            index={startIndex + i}
            isRecent={i === 0 && date === 'Today'}
          />
        ))}
      </div>
    </div>
  );
};

export default TimelineEntry;
export {
  LabResultContent,
  MedicationContent,
  NotePreview,
  ReferralContent,
  TimelineEntry,
  TimelineGroup,
  VitalsContent,
};
