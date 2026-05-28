import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import TestTube from 'lucide-react/dist/esm/icons/test-tube.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatEncounterScopeLabel,
} from "@/features/patients/chronicle/useChronicleTimelineViewModel";
import ChronicleTimelineEntries from "@/features/patients/chronicle/ChronicleTimelineEntries";
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
        {isTimelineLoading ? (
          <LoadingSpinner className="h-3.5 w-7 sm:mr-1.5" />
        ) : (
          <RefreshCw className="size-3.5 sm:mr-1.5" />
        )}
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
