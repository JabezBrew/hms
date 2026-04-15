import { lazy, Suspense, useState, useCallback } from 'react';
import Expand from 'lucide-react/dist/esm/icons/expand.js';
import Copy from 'lucide-react/dist/esm/icons/copy.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import MousePointerClick from 'lucide-react/dist/esm/icons/mouse-pointer-click.js';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getEntryConfig, getBadgeClass } from './entryConfig';
import {
  hasEntryDetailContent,
  isInlineExpandableNoteEntry,
  normalizeExpansionId,
} from './chronicleNoteUtils';
import {
  VitalsContent,
  LabResultContent,
  MedicationContent,
  ReferralContent,
  ExpandedNoteContent,
  ChartSummaryContent,
  NotePreview,
} from './TimelineEntry';

const NoteDetailModal = lazy(() => import('./NoteDetailModal'));
const CopyNoteModal = lazy(() => import('./CopyNoteModal'));

/**
 * Format a timestamp to a full display string.
 */
function formatTime(timestamp) {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

const COPYABLE_TYPES = new Set([
  'progress_note', 'soap_note', 'nursing_note', 'admission_note',
  'discharge_note', 'consult_note', 'procedure',
]);

const EDITABLE_TYPES = new Set([
  'progress_note', 'soap_note', 'nursing_note', 'admission_note',
  'discharge_note', 'consult_note', 'procedure',
]);

/**
 * TimelineDetailPanel — The right panel of the master-detail Chronicle layout.
 *
 * Shows full content of the selected timeline entry (vitals grid, SOAP note sections,
 * lab result tables, medication details, etc.). For note types, always renders
 * the expanded content (that's the purpose of the detail view).
 */
const TimelineDetailPanel = ({
  entry,
  currentUserId,
  onCopyNote,
  onEditNote,
  onNoteUpdated,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);

  const handleEditClick = useCallback(() => {
    if (!entry || !onEditNote) return;
    onEditNote({
      noteId: entry.id,
      template: entry.template,
      templateId: entry.template?.id || entry.template_id,
      templateTitle: entry.template?.title || entry.template_title || entry.title,
      data: entry.data,
      title: entry.title,
    });
  }, [entry, onEditNote]);

  const handleCopyConfirm = useCallback(
    (copyData) => {
      if (onCopyNote) onCopyNote(copyData);
    },
    [onCopyNote]
  );

  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center space-y-3">
          <MousePointerClick className="h-8 w-8 mx-auto text-muted-foreground/40" />
          <p className="font-mono text-sm text-muted-foreground">
            Select an entry to view details
          </p>
        </div>
      </div>
    );
  }

  const config = getEntryConfig(entry.type);
  const Icon = config.icon;
  const hasDetail = hasEntryDetailContent(entry);
  const canInlineExpand = isInlineExpandableNoteEntry(entry);
  const noteBodyId = normalizeExpansionId(entry?.id)
    ? `chronicle-detail-body-${normalizeExpansionId(entry.id)}`
    : undefined;

  const isCopyable =
    COPYABLE_TYPES.has(entry.type) &&
    entry.id &&
    entry.data &&
    typeof entry.data === 'object';

  const isEditable =
    EDITABLE_TYPES.has(entry.type) &&
    entry.id &&
    entry.template &&
    entry.data &&
    typeof entry.data === 'object' &&
    currentUserId &&
    entry.author_id &&
    String(currentUserId) === String(entry.author_id);

  // Render the full content for the entry type.
  // Notes always render expanded in the detail panel.
  const renderContent = () => {
    switch (entry.type) {
      case 'vitals':
        return <VitalsContent vitals={entry.data} />;
      case 'lab_result':
        return <LabResultContent result={entry.data} />;
      case 'medication':
      case 'prescription':
        return <MedicationContent medication={entry.data} entry={entry} />;
      case 'referral':
        return <ReferralContent referral={entry.data} />;
      case 'chart':
        return <ChartSummaryContent entry={entry} />;
      default:
        // Notes: always show expanded content in the detail panel
        if (canInlineExpand) {
          return <ExpandedNoteContent entry={entry} noteBodyId={noteBodyId} />;
        }
        return <NotePreview entry={entry} />;
    }
  };

  return (
    <ScrollArea className="h-full chronicle-scrollbar">
      <div className="p-6 max-w-3xl">
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <span className={getBadgeClass(config.color)}>
                <Icon className="h-3 w-3 mr-1 inline" />
                {config.label}
              </span>
              {entry.has_edits && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Pencil className="h-2.5 w-2.5" />
                  Edited
                  {entry.updated_at && (
                    <span className="text-amber-500/70 ml-1">
                      · {formatRelativeTime(entry.updated_at)}
                    </span>
                  )}
                </span>
              )}
            </div>
            {entry.author && (
              <span className="font-mono text-xs text-muted-foreground">
                {entry.author}
              </span>
            )}
          </div>
          <time className="font-mono text-xs text-primary">
            {formatTime(entry.timestamp)}
          </time>
        </div>

        {/* Content */}
        <div className="mb-5">{renderContent()}</div>

        {/* Actions */}
        {(hasDetail || isCopyable || isEditable) && (
          <div className="flex items-center gap-3 border-t border-border/50 pt-4">
            {hasDetail && (
              <Button
                variant="ghost"
                size="sm"
                className="font-mono text-xs text-primary p-0 h-auto hover:bg-transparent"
                onClick={() => setIsModalOpen(true)}
              >
                <Expand className="h-3 w-3 mr-1" />
                Focus view
              </Button>
            )}
            {isEditable && onEditNote && (
              <Button
                variant="ghost"
                size="sm"
                className="font-mono text-xs text-muted-foreground p-0 h-auto hover:bg-transparent hover:text-primary"
                onClick={handleEditClick}
              >
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
            )}
            {isCopyable && (
              <Button
                variant="ghost"
                size="sm"
                className="font-mono text-xs text-muted-foreground p-0 h-auto hover:bg-transparent hover:text-primary"
                onClick={() => setIsCopyModalOpen(true)}
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy note
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Focus view modal */}
      {isModalOpen && (
        <Suspense fallback={null}>
          <NoteDetailModal
            open={isModalOpen}
            onOpenChange={setIsModalOpen}
            entry={entry}
            currentUserId={currentUserId}
            onEditNote={onEditNote}
            onNoteUpdated={onNoteUpdated}
          />
        </Suspense>
      )}

      {/* Copy note modal */}
      {isCopyable && isCopyModalOpen && (
        <Suspense fallback={null}>
          <CopyNoteModal
            open={isCopyModalOpen}
            onOpenChange={setIsCopyModalOpen}
            noteEntry={{
              id: entry.id,
              template: entry.template,
              template_id: entry.template_id,
              template_title:
                entry.template_title || entry.title || config.label,
              data: entry.data,
            }}
            onCopyConfirm={handleCopyConfirm}
          />
        </Suspense>
      )}
    </ScrollArea>
  );
};

export default TimelineDetailPanel;
