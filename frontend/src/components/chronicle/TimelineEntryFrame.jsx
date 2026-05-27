import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js';
import Copy from 'lucide-react/dist/esm/icons/copy.js';
import Expand from 'lucide-react/dist/esm/icons/expand.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import { lazy, Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatRelativeTimelineTime,
  formatTimelineTime,
  getTimelineBadgeClass,
} from "./timelineEntryFrameUtils";

const NoteDetailModal = lazy(() => import("./NoteDetailModal"));
const CopyNoteModal = lazy(() => import("./CopyNoteModal"));

const TimelineEntryMeta = ({ entry, config, entryTimestamp }) => {
  const Icon = config.icon;

  return (
    <div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
        <time className="min-w-0 [overflow-wrap:anywhere] font-mono text-xs text-primary">
          {formatTimelineTime(entryTimestamp)}
        </time>
        <span className={getTimelineBadgeClass(config.color)}>
          <Icon className="size-3 mr-1 inline" />
          {config.label}
        </span>
        {entry.has_edits && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Pencil className="size-2.5" />
            Edited
            {entry.updated_at && (
              <span className="text-amber-500/70 ml-1">
                · {formatRelativeTimelineTime(entry.updated_at)}
              </span>
            )}
          </span>
        )}
      </div>
      {entry.author && (
        <span className="min-w-0 [overflow-wrap:anywhere] font-mono text-xs text-muted-foreground sm:text-right">
          {entry.author}
        </span>
      )}
    </div>
  );
};

const TimelineEntryActions = ({
  capabilities,
  noteBodyId,
  noteExpanded,
  onEditClick,
  onOpenCopyModal,
  onOpenDetailModal,
  onToggleNoteExpanded,
}) => {
  const { canCopyNote, canEditNote, canInlineExpand, hasDetailContent } = capabilities;

  if (!hasDetailContent && !canCopyNote && !canEditNote && !canInlineExpand) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      {canInlineExpand && (
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-xs text-primary p-0 h-auto hover:bg-transparent"
          onClick={onToggleNoteExpanded}
          aria-controls={noteBodyId}
          aria-expanded={noteExpanded}
        >
          {noteExpanded ? (
            <ChevronUp className="size-3 mr-1" />
          ) : (
            <ChevronDown className="size-3 mr-1" />
          )}
          {noteExpanded ? 'Collapse note' : 'Open note'}
        </Button>
      )}
      {hasDetailContent && (
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-xs text-primary p-0 h-auto hover:bg-transparent"
          onClick={onOpenDetailModal}
        >
          <Expand className="size-3 mr-1" />
          {canInlineExpand ? 'Focus view' : 'View details'}
        </Button>
      )}
      {canEditNote && (
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-xs text-muted-foreground p-0 h-auto hover:bg-transparent hover:text-primary"
          onClick={onEditClick}
        >
          <Pencil className="size-3 mr-1" />
          Edit
        </Button>
      )}
      {canCopyNote && (
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-xs text-muted-foreground p-0 h-auto hover:bg-transparent hover:text-primary"
          onClick={onOpenCopyModal}
        >
          <Copy className="size-3 mr-1" />
          Copy note
        </Button>
      )}
    </div>
  );
};

const TimelineEntryModals = ({
  canCopyNote,
  copyNoteEntry,
  currentUserId,
  entry,
  isCopyModalOpen,
  isModalOpen,
  onCopyNote,
  onEditNote,
  onNoteUpdated,
  setIsCopyModalOpen,
  setIsModalOpen,
}) => (
  <>
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

    {canCopyNote && isCopyModalOpen && (
      <Suspense fallback={null}>
        <CopyNoteModal
          open={isCopyModalOpen}
          onOpenChange={setIsCopyModalOpen}
          noteEntry={copyNoteEntry}
          onCopyConfirm={onCopyNote}
        />
      </Suspense>
    )}
  </>
);

const TimelineEntryFrame = ({
  capabilities,
  children,
  className,
  config,
  copyNoteEntry,
  currentUserId,
  entry,
  entryTimestamp,
  hasAnimated,
  index,
  isRecent,
  noteBodyId,
  noteExpanded,
  onEditClick,
  onEditNote,
  onNoteUpdated,
  onCopyNote,
  onToggleNoteExpanded,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);

  return (
    <article
      className={cn(
        "relative min-w-0 max-w-full pl-5 pb-8 last:pb-0 sm:pl-8",
        !hasAnimated && "animate-chronicle-enter",
        className
      )}
      style={!hasAnimated ? { animationDelay: `${index * 50}ms` } : undefined}
    >
      <div className="timeline-spine" />
      <div className={cn(
        "timeline-node",
        config.nodeClass,
        isRecent && "animate-node-pulse"
      )} />

      <div className={cn(
        "min-w-0 max-w-full overflow-hidden bg-card/30 rounded-xl border border-border/50 p-4 sm:p-5",
        "hover:border-border transition-colors group"
      )}>
        <TimelineEntryMeta
          config={config}
          entry={entry}
          entryTimestamp={entryTimestamp}
        />
        {children}
        <TimelineEntryActions
          capabilities={capabilities}
          noteBodyId={noteBodyId}
          noteExpanded={noteExpanded}
          onEditClick={onEditClick}
          onOpenCopyModal={() => setIsCopyModalOpen(true)}
          onOpenDetailModal={() => setIsModalOpen(true)}
          onToggleNoteExpanded={onToggleNoteExpanded}
        />
      </div>

      <TimelineEntryModals
        canCopyNote={capabilities.canCopyNote}
        copyNoteEntry={copyNoteEntry}
        currentUserId={currentUserId}
        entry={entry}
        isCopyModalOpen={isCopyModalOpen}
        isModalOpen={isModalOpen}
        onCopyNote={onCopyNote}
        onEditNote={onEditNote}
        onNoteUpdated={onNoteUpdated}
        setIsCopyModalOpen={setIsCopyModalOpen}
        setIsModalOpen={setIsModalOpen}
      />
    </article>
  );
};

export default TimelineEntryFrame;
