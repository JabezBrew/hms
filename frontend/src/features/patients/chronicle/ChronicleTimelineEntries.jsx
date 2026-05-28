import Pill from 'lucide-react/dist/esm/icons/pill.js';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import TimelineEntry from "@/components/chronicle/TimelineEntry";
import { normalizeExpansionId } from "@/components/chronicle/chronicleNoteUtils";
import { getEncounterKind } from "@/features/patients/chronicle/chronicleEncounterUtils";
import {
  formatEncounterDateRange,
  getEncounterTitle,
  getEntryTimestamp,
} from "@/features/patients/chronicle/useChronicleTimelineViewModel";

function TimelineEntryList({
  entries,
  expandedNoteIds,
  userId,
  onCopyNote,
  onEditNote,
  onNoteUpdated,
  onToggleNoteExpanded,
}) {
  return entries.map((entry, index) => (
    <TimelineEntry
      key={entry.id}
      entry={entry}
      index={index}
      currentUserId={userId}
      isNoteExpanded={entry.id !== null && entry.id !== undefined
        ? expandedNoteIds.has(String(entry.id))
        : false}
      onToggleNoteExpanded={onToggleNoteExpanded}
      onCopyNote={onCopyNote}
      onEditNote={onEditNote}
      onNoteUpdated={onNoteUpdated}
    />
  ));
}

function EncounterGroup({
  encounter,
  entries,
  expandedEncounters,
  expandedNoteIds,
  userId,
  onCopyNote,
  onEditNote,
  onRecordFluids,
  onToggleEncounter,
  onToggleNoteExpanded,
  onViewMedicationHistory,
  onNoteUpdated,
}) {
  const normalizedEncounterId = normalizeExpansionId(encounter.id);
  const isExpanded = normalizedEncounterId
    ? expandedEncounters.has(normalizedEncounterId)
    : false;
  const dateRange = formatEncounterDateRange(encounter, getEntryTimestamp(entries[0]));
  const encounterKind = getEncounterKind(encounter);
  const isInpatientKind = ['inpatient', 'admission', 'hospitalization'].includes(encounterKind);
  const TypeIcon = isInpatientKind ? Building2 : Calendar;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex w-full flex-col gap-3 p-3 text-left transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:px-4">
        <button
          type="button"
          onClick={() => onToggleEncounter(normalizedEncounterId)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left sm:items-center"
        >
          {isExpanded ? (
            <ChevronDown className="size-4 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 flex-shrink-0 text-muted-foreground" />
          )}

          <div className={cn(
            "shrink-0 rounded-lg p-2",
            isInpatientKind ? "bg-blue-500/10" : "bg-amber-500/10"
          )}>
            <TypeIcon className={cn(
              "size-4",
              isInpatientKind ? "text-blue-500" : "text-amber-500"
            )} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium capitalize">
                {getEncounterTitle(encounter)}
              </span>
              {encounter.status && (
                <span className={cn(
                  "rounded-full px-2 py-0.5 font-mono text-xs",
                  encounter.status === 'finished' && "bg-muted text-muted-foreground",
                  encounter.status === 'in-progress' && "bg-green-500/10 text-green-600",
                  encounter.status === 'cancelled' && "bg-red-500/10 text-red-600"
                )}>
                  {encounter.status}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{dateRange}</span>
              {encounter.practitioner_name && (
                <>
                  <span>•</span>
                  <span>{encounter.practitioner_name}</span>
                </>
              )}
              {encounter.location && (
                <>
                  <span>•</span>
                  <span>{encounter.location}</span>
                </>
              )}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="hidden xl:flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 font-mono text-[10px]"
              onClick={(event) => {
                event.stopPropagation();
                onViewMedicationHistory();
              }}
            >
              <Pill className="size-3.5 mr-1" />
              Meds
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 font-mono text-[10px]"
              onClick={(event) => {
                event.stopPropagation();
                onRecordFluids();
              }}
            >
              <Droplets className="size-3.5 mr-1" />
              Fluids
            </Button>
          </div>

          <span className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      </div>

      <div className={cn("min-w-0 space-y-3 border-t border-border p-3 sm:px-4", !isExpanded && "hidden")}>
        <TimelineEntryList
          entries={entries}
          expandedNoteIds={expandedNoteIds}
          userId={userId}
          onCopyNote={onCopyNote}
          onEditNote={onEditNote}
          onNoteUpdated={onNoteUpdated}
          onToggleNoteExpanded={onToggleNoteExpanded}
        />
      </div>
    </div>
  );
}

function UnlinkedEntriesGroup({
  entries,
  expandedEncounters,
  expandedNoteIds,
  userId,
  onCopyNote,
  onEditNote,
  onNoteUpdated,
  onToggleEncounter,
  onToggleNoteExpanded,
}) {
  if (entries.length === 0) {
    return null;
  }

  const isExpanded = expandedEncounters.has('unlinked');

  return (
    <div className="overflow-hidden rounded-lg border border-dashed border-border bg-card/50">
      <button
        type="button"
        onClick={() => onToggleEncounter('unlinked')}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
      >
        {isExpanded ? (
          <ChevronDown className="size-4 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 flex-shrink-0 text-muted-foreground" />
        )}

        <div className="rounded-lg bg-muted p-2">
          <AlertCircle className="size-4 text-muted-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              Unlinked Entries
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Legacy data without encounter context
          </div>
        </div>

        <span className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </span>
      </button>

      <div className={cn("min-w-0 space-y-3 border-t border-dashed border-border p-3 sm:px-4", !isExpanded && "hidden")}>
        <TimelineEntryList
          entries={entries}
          expandedNoteIds={expandedNoteIds}
          userId={userId}
          onCopyNote={onCopyNote}
          onEditNote={onEditNote}
          onNoteUpdated={onNoteUpdated}
          onToggleNoteExpanded={onToggleNoteExpanded}
        />
      </div>
    </div>
  );
}

function TimelineInitialLoadingState({ isLoading }) {
  if (!isLoading) {
    return null;
  }

  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="pl-8 pb-6">
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}

function TimelineEmptyState({
  filteredEntryCount,
  isTimelineLoading,
  searchInput,
  selectedEncounterId,
  onClearSearch,
  onViewAllHistory,
}) {
  if (isTimelineLoading || filteredEntryCount > 0) {
    return null;
  }

  return (
    <div className="py-12 text-center text-muted-foreground">
      <p className="font-mono text-sm">
        {searchInput
          ? 'No entries match your search'
          : selectedEncounterId
            ? 'No chronicle entries for this visit yet'
            : 'No entries found'}
      </p>
      {searchInput && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSearch}
          className="mt-2 font-mono text-xs"
        >
          Clear search
        </Button>
      )}
      {!searchInput && selectedEncounterId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewAllHistory}
          className="mt-2 font-mono text-xs"
        >
          View all history
        </Button>
      )}
    </div>
  );
}

function TimelinePaginationState({
  filteredEntryCount,
  hasNextPage,
  isFetchingNextPage,
  loadMoreRef,
  onFetchNextPage,
}) {
  if (hasNextPage) {
    return (
      <div
        ref={loadMoreRef}
        className="flex items-center justify-center py-8"
      >
        {isFetchingNextPage ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <LoadingSpinner className="size-4" />
            <span className="font-mono text-xs">Loading more…</span>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={onFetchNextPage}
            className="font-mono text-xs"
          >
            Load more
          </Button>
        )}
      </div>
    );
  }

  if (filteredEntryCount === 0) {
    return null;
  }

  return (
    <div className="py-8 text-center text-muted-foreground">
      <div className="mx-auto mb-2 h-px w-12 bg-border" />
      <p className="font-mono text-xs">End of timeline</p>
    </div>
  );
}

export default function ChronicleTimelineEntries({
  expandedEncounters,
  expandedNoteIds,
  filteredEntries,
  groupedByEncounter,
  loadMoreRef,
  searchInput,
  selectedEncounterId,
  timelineState,
  userId,
  onClearSearch,
  onCopyNote,
  onEditNote,
  onFetchNextPage,
  onNoteUpdated,
  onRecordFluids,
  onToggleEncounter,
  onToggleNoteExpanded,
  onViewAllHistory,
  onViewMedicationHistory,
}) {
  const {
    hasNextPage,
    isFetchingNextPage,
    isTimelineLoading,
    isVisitScopePending,
  } = timelineState;
  const isInitialLoading = (isTimelineLoading || isVisitScopePending) && filteredEntries.length === 0;

  return (
    <div className="relative min-w-0 max-w-full space-y-4">
      <TimelineInitialLoadingState isLoading={isInitialLoading} />

      {groupedByEncounter.encounters.map(({ encounter, entries }) => (
        <EncounterGroup
          key={encounter.id}
          encounter={encounter}
          entries={entries}
          expandedEncounters={expandedEncounters}
          expandedNoteIds={expandedNoteIds}
          userId={userId}
          onCopyNote={onCopyNote}
          onEditNote={onEditNote}
          onNoteUpdated={onNoteUpdated}
          onRecordFluids={onRecordFluids}
          onToggleEncounter={onToggleEncounter}
          onToggleNoteExpanded={onToggleNoteExpanded}
          onViewMedicationHistory={onViewMedicationHistory}
        />
      ))}

      <UnlinkedEntriesGroup
        entries={groupedByEncounter.unlinked}
        expandedEncounters={expandedEncounters}
        expandedNoteIds={expandedNoteIds}
        userId={userId}
        onCopyNote={onCopyNote}
        onEditNote={onEditNote}
        onNoteUpdated={onNoteUpdated}
        onToggleEncounter={onToggleEncounter}
        onToggleNoteExpanded={onToggleNoteExpanded}
      />

      <TimelineEmptyState
        filteredEntryCount={filteredEntries.length}
        isTimelineLoading={isTimelineLoading}
        searchInput={searchInput}
        selectedEncounterId={selectedEncounterId}
        onClearSearch={onClearSearch}
        onViewAllHistory={onViewAllHistory}
      />

      <TimelinePaginationState
        filteredEntryCount={filteredEntries.length}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMoreRef={loadMoreRef}
        onFetchNextPage={onFetchNextPage}
      />
    </div>
  );
}
