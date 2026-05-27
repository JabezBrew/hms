import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import TestTube from 'lucide-react/dist/esm/icons/test-tube.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Droplets from 'lucide-react/dist/esm/icons/droplets.js';

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import TimelineEntry from "@/components/chronicle/TimelineEntry";
import { normalizeExpansionId } from "@/components/chronicle/chronicleNoteUtils";
import { getEncounterKind } from "@/features/patients/chronicle/chronicleEncounterUtils";
import {
  formatEncounterDateRange,
  formatEncounterScopeLabel,
  getEncounterTitle,
  getEntryTimestamp,
} from "@/features/patients/chronicle/useChronicleTimelineViewModel";
import { CHRONICLE_ALL_VISITS } from "@/features/patients/chronicle/visitScopeUtils";

const CHRONICLE_FILTER_OPTIONS = [
  { key: 'all', label: 'All', icon: null, onboardingId: 'chronicle-filter-all' },
  { key: 'progress_note', label: 'Notes', icon: FileText, onboardingId: 'chronicle-filter-notes' },
  { key: 'vitals', label: 'Vitals', icon: Activity },
  { key: 'medication', label: 'Meds', icon: Pill },
  { key: 'lab_result', label: 'Labs', icon: TestTube },
];

function ChronicleTimelineTitle({
  activeEncounterId,
  documentedEncounterCount,
  encounterCount,
  isAllVisitsScope,
  isTimelineLoading,
  selectedEncounter,
  totalCount,
  onRefresh,
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Clock className="size-5 text-muted-foreground" />
          <h2 className="font-display text-xl text-foreground sm:text-2xl">
            Clinical Chronicle
          </h2>
          {totalCount > 0 && (
            <span className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
              {totalCount} {totalCount === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          {selectedEncounter && !isAllVisitsScope && (
            <p className="min-w-0 [overflow-wrap:anywhere] font-mono text-xs text-muted-foreground/80">
              Focused on {formatEncounterScopeLabel(selectedEncounter, activeEncounterId)}
            </p>
          )}
          {isAllVisitsScope && encounterCount > 0 && encounterCount > documentedEncounterCount && (
            <p className="font-mono text-xs text-muted-foreground/70" title="Some encounters have no clinical documentation">
              {encounterCount} encounters ({documentedEncounterCount} documented)
            </p>
          )}
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        aria-label="Refresh timeline"
        className="size-9 shrink-0 p-0 font-mono text-xs sm:w-auto sm:px-3"
      >
        <RefreshCw className={cn(
          "size-3.5 sm:mr-1.5",
          isTimelineLoading && "animate-spin"
        )} />
        <span className="hidden sm:inline">Refresh</span>
      </Button>
    </div>
  );
}

function VisitScopeSelector({
  activeEncounterId,
  isAllVisitsScope,
  resolvedVisitScope,
  selectedEncounterId,
  visitScopeOptions,
  onViewAllHistory,
  onViewCurrentVisit,
  onVisitScopeChange,
}) {
  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
      <div className="flex items-center gap-2">
        <Calendar className="size-4 text-muted-foreground" />
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Visit focus
        </span>
      </div>
      <Select
        value={resolvedVisitScope || CHRONICLE_ALL_VISITS}
        onValueChange={onVisitScopeChange}
      >
        <SelectTrigger className="w-full font-mono text-xs sm:min-w-[260px] sm:max-w-[420px]">
          <SelectValue placeholder="Select visit" />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          {visitScopeOptions.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="font-mono text-xs"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!isAllVisitsScope && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewAllHistory}
          className="h-8 self-start px-2 font-mono text-xs"
        >
          All history
        </Button>
      )}
      {activeEncounterId && selectedEncounterId !== String(activeEncounterId) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewCurrentVisit}
          className="h-8 self-start px-2 font-mono text-xs"
        >
          Current visit
        </Button>
      )}
    </div>
  );
}

function ChronicleFilterTabs({ activeFilter, onFilterChange }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
      <Filter className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
      <div className="flex w-full min-w-0 max-w-full overflow-x-auto rounded-lg bg-muted p-1 [-webkit-overflow-scrolling:touch] sm:w-auto" data-onboarding="chronicle-filter-group">
        {CHRONICLE_FILTER_OPTIONS.map((filter) => {
          const FilterIcon = filter.icon;

          return (
            <button
              type="button"
              key={filter.key}
              onClick={() => onFilterChange(filter.key)}
              data-onboarding={filter.onboardingId}
              className={cn(
                "shrink-0 px-2 py-1.5 rounded-md font-mono text-xs transition-colors sm:px-3",
                "flex items-center gap-1 sm:gap-1.5",
                activeFilter === filter.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {FilterIcon && <FilterIcon className="size-3" />}
              {filter.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChronicleSearchAndFilters({
  activeFilter,
  isAllVisitsScope,
  searchInput,
  onCollapseAll,
  onExpandAll,
  onFilterChange,
  onSearchInputChange,
}) {
  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
      <div className="relative w-full min-w-0 sm:max-w-sm sm:flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search notes, prescriptions..."
          value={searchInput}
          onChange={(event) => onSearchInputChange(event.target.value)}
          className="pl-9 font-mono text-sm"
        />
      </div>

      <ChronicleFilterTabs
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
      />

      {isAllVisitsScope && (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onExpandAll}
            className="h-8 px-2 font-mono text-xs"
          >
            Expand visits
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCollapseAll}
            className="h-8 px-2 font-mono text-xs"
          >
            Collapse visits
          </Button>
        </div>
      )}
    </div>
  );
}

function ChronicleTimelineHeader({
  activeEncounterId,
  activeFilter,
  documentedEncounterCount,
  encounterCount,
  isAllVisitsScope,
  isTimelineLoading,
  resolvedVisitScope,
  searchInput,
  selectedEncounter,
  selectedEncounterId,
  totalCount,
  visitScopeOptions,
  onCollapseAll,
  onExpandAll,
  onFilterChange,
  onRefresh,
  onSearchInputChange,
  onViewAllHistory,
  onViewCurrentVisit,
  onVisitScopeChange,
}) {
  return (
    <div className="mb-6 space-y-4">
      <ChronicleTimelineTitle
        activeEncounterId={activeEncounterId}
        documentedEncounterCount={documentedEncounterCount}
        encounterCount={encounterCount}
        isAllVisitsScope={isAllVisitsScope}
        isTimelineLoading={isTimelineLoading}
        selectedEncounter={selectedEncounter}
        totalCount={totalCount}
        onRefresh={onRefresh}
      />
      <VisitScopeSelector
        activeEncounterId={activeEncounterId}
        isAllVisitsScope={isAllVisitsScope}
        resolvedVisitScope={resolvedVisitScope}
        selectedEncounterId={selectedEncounterId}
        visitScopeOptions={visitScopeOptions}
        onViewAllHistory={onViewAllHistory}
        onViewCurrentVisit={onViewCurrentVisit}
        onVisitScopeChange={onVisitScopeChange}
      />
      <ChronicleSearchAndFilters
        activeFilter={activeFilter}
        isAllVisitsScope={isAllVisitsScope}
        searchInput={searchInput}
        onCollapseAll={onCollapseAll}
        onExpandAll={onExpandAll}
        onFilterChange={onFilterChange}
        onSearchInputChange={onSearchInputChange}
      />
    </div>
  );
}

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
            <Loader2 className="size-4 animate-spin" />
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

function ChronicleTimelineEntries({
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

export default function ChronicleTimelinePanel({
  activeEncounter,
  activeFilter,
  encounterCount,
  expandedEncounters,
  expandedNoteIds,
  filteredEntries,
  groupedByEncounter,
  loadMoreRef,
  searchInput,
  selectedEncounter,
  timelineState,
  totalCount,
  userId,
  visitState,
  visitScopeOptions,
  onClearSearch,
  onCollapseAll,
  onCopyNote,
  onEditNote,
  onExpandAll,
  onFetchNextPage,
  onFilterChange,
  onNoteUpdated,
  onRecordFluids,
  onRefresh,
  onSearchInputChange,
  onToggleEncounter,
  onToggleNoteExpanded,
  onViewAllHistory,
  onViewCurrentVisit,
  onViewMedicationHistory,
  onVisitScopeChange,
}) {
  const {
    isAllVisitsScope,
    resolvedVisitScope,
    selectedEncounterId,
  } = visitState;
  const { isTimelineLoading } = timelineState;

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl">
      <ChronicleTimelineHeader
        activeEncounterId={activeEncounter?.id}
        activeFilter={activeFilter}
        documentedEncounterCount={groupedByEncounter.encounters.length}
        encounterCount={encounterCount}
        isAllVisitsScope={isAllVisitsScope}
        isTimelineLoading={isTimelineLoading}
        resolvedVisitScope={resolvedVisitScope}
        searchInput={searchInput}
        selectedEncounter={selectedEncounter}
        selectedEncounterId={selectedEncounterId}
        totalCount={totalCount}
        visitScopeOptions={visitScopeOptions}
        onCollapseAll={onCollapseAll}
        onExpandAll={onExpandAll}
        onFilterChange={onFilterChange}
        onRefresh={onRefresh}
        onSearchInputChange={onSearchInputChange}
        onViewAllHistory={onViewAllHistory}
        onViewCurrentVisit={onViewCurrentVisit}
        onVisitScopeChange={onVisitScopeChange}
      />
      <ChronicleTimelineEntries
        expandedEncounters={expandedEncounters}
        expandedNoteIds={expandedNoteIds}
        filteredEntries={filteredEntries}
        groupedByEncounter={groupedByEncounter}
        loadMoreRef={loadMoreRef}
        searchInput={searchInput}
        selectedEncounterId={selectedEncounterId}
        timelineState={timelineState}
        userId={userId}
        onClearSearch={onClearSearch}
        onCopyNote={onCopyNote}
        onEditNote={onEditNote}
        onFetchNextPage={onFetchNextPage}
        onNoteUpdated={onNoteUpdated}
        onRecordFluids={onRecordFluids}
        onToggleEncounter={onToggleEncounter}
        onToggleNoteExpanded={onToggleNoteExpanded}
        onViewAllHistory={onViewAllHistory}
        onViewMedicationHistory={onViewMedicationHistory}
      />
    </div>
  );
}
