import { useRef, useEffect, useCallback } from 'react';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { getEntryConfig, getDotColorClass, getEntryIndexSummary } from './entryConfig';
import { normalizeExpansionId } from './chronicleNoteUtils';

/**
 * Format relative time for compact display.
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * Get initials from a full name for compact display.
 */
function getInitials(name) {
  if (!name) return '';
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Determine encounter kind from encounter data.
 */
function getEncounterKind(encounter) {
  if (encounter?.encounter_type === 'inpatient' || encounter?.encounter_type === 'emergency') {
    return 'inpatient';
  }
  return 'outpatient';
}

/**
 * Compact entry row (~48px) for the timeline index.
 */
const TimelineIndexEntry = ({ entry, isSelected, onSelect }) => {
  const config = getEntryConfig(entry.type);
  const Icon = config.icon;
  const summary = getEntryIndexSummary(entry);
  const ref = useRef(null);

  // Scroll selected entry into view
  useEffect(() => {
    if (isSelected && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isSelected]);

  return (
    <button
      ref={ref}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors',
        'hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        isSelected && 'bg-accent border-l-2 border-primary',
        !isSelected && 'border-l-2 border-transparent'
      )}
    >
      {/* Color dot */}
      <div
        className={cn(
          'h-2 w-2 rounded-full shrink-0',
          getDotColorClass(config.color)
        )}
      />

      {/* Icon */}
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

      {/* Summary text */}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground/80">
        {summary}
      </span>

      {/* Time + author */}
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatRelativeTime(entry.timestamp)}
        </span>
        {entry.author && (
          <span
            className="font-mono text-[10px] text-muted-foreground/60"
            title={entry.author}
          >
            {getInitials(entry.author)}
          </span>
        )}
      </div>
    </button>
  );
};

/**
 * TimelineIndex — Compact scrollable index for the Chronicle master-detail layout.
 *
 * Renders encounter accordion headers with compact entry rows inside.
 * Includes infinite scroll trigger at the bottom.
 */
const TimelineIndex = ({
  groupedByEncounter,
  expandedEncounters,
  toggleEncounter,
  selectedEntryId,
  onSelectEntry,
  formatEncounterDateRange,
  // Infinite scroll
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  // Loading / empty state
  isLoading,
  isEmpty,
  searchInput,
  onClearSearch,
  onViewAllHistory,
  selectedEncounterId,
}) => {
  const loadMoreRef = useRef(null);
  const scrollAreaRef = useRef(null);

  // Infinite scroll observer inside the index scroll container
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e) => {
      // Only handle when focus is within the index
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        // Find next entry — handled by parent via selectNext
        const event = new CustomEvent('chronicle:selectNext');
        window.dispatchEvent(event);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const event = new CustomEvent('chronicle:selectPrevious');
        window.dispatchEvent(event);
      }
    },
    []
  );

  return (
    <ScrollArea
      ref={scrollAreaRef}
      className="h-full chronicle-scrollbar"
    >
      <div
        role="listbox"
        aria-label="Timeline entries"
        onKeyDown={handleKeyDown}
        className="py-2"
      >
        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-2 px-3 py-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 rounded bg-muted/60 animate-pulse" />
            ))}
          </div>
        )}

        {/* Encounter groups */}
        {(groupedByEncounter?.encounters || []).map(({ encounter, entries }) => {
          const normalizedId = normalizeExpansionId(encounter.id);
          const isExpanded = normalizedId
            ? expandedEncounters.has(normalizedId)
            : false;
          const encounterKind = getEncounterKind(encounter);
          const TypeIcon = encounterKind === 'inpatient' ? Building2 : Calendar;
          const dateRange = formatEncounterDateRange?.(encounter) || '';

          return (
            <div key={encounter.id}>
              {/* Encounter header — compact */}
              <button
                onClick={() => toggleEncounter(normalizedId)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/50 border-b border-border/30"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <TypeIcon
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    encounterKind === 'inpatient' ? 'text-blue-500' : 'text-amber-500'
                  )}
                />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-medium capitalize truncate block">
                    {encounter.encounter_type === 'inpatient'
                      ? 'Inpatient'
                      : encounter.encounter_type === 'emergency'
                        ? 'Emergency'
                        : 'Outpatient'}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate block">
                    {dateRange}
                  </span>
                </div>
                <span className={cn(
                  'rounded-full px-1.5 py-0.5 font-mono text-[10px]',
                  encounter.status === 'in-progress' && 'bg-green-500/10 text-green-600',
                  encounter.status === 'finished' && 'bg-muted text-muted-foreground',
                  encounter.status === 'cancelled' && 'bg-red-500/10 text-red-600'
                )}>
                  {entries.length}
                </span>
              </button>

              {/* Entry rows */}
              {isExpanded && (
                <div>
                  {entries.map((entry) => (
                    <TimelineIndexEntry
                      key={entry.id}
                      entry={entry}
                      isSelected={String(entry.id) === String(selectedEntryId)}
                      onSelect={() => onSelectEntry(entry.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Unlinked entries */}
        {(groupedByEncounter?.unlinked || []).length > 0 && (
          <div>
            <button
              onClick={() => toggleEncounter('unlinked')}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/50 border-b border-dashed border-border/30"
            >
              {expandedEncounters.has('unlinked') ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground flex-1">
                Unlinked
              </span>
              <span className="rounded-full px-1.5 py-0.5 font-mono text-[10px] bg-muted text-muted-foreground">
                {groupedByEncounter.unlinked.length}
              </span>
            </button>
            {expandedEncounters.has('unlinked') && (
              <div>
                {groupedByEncounter.unlinked.map((entry) => (
                  <TimelineIndexEntry
                    key={entry.id}
                    entry={entry}
                    isSelected={String(entry.id) === String(selectedEntryId)}
                    onSelect={() => onSelectEntry(entry.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && isEmpty && (
          <div className="py-8 text-center text-muted-foreground px-4">
            <p className="font-mono text-xs">
              {searchInput
                ? 'No entries match your search'
                : selectedEncounterId
                  ? 'No entries for this visit'
                  : 'No entries found'}
            </p>
            {searchInput && onClearSearch && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearSearch}
                className="mt-2 font-mono text-xs"
              >
                Clear search
              </Button>
            )}
            {!searchInput && selectedEncounterId && onViewAllHistory && (
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
        )}

        {/* Infinite scroll trigger */}
        {hasNextPage && (
          <div ref={loadMoreRef} className="flex items-center justify-center py-4">
            {isFetchingNextPage ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="font-mono text-[10px]">Loading...</span>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchNextPage()}
                className="font-mono text-[10px]"
              >
                Load more
              </Button>
            )}
          </div>
        )}

        {/* End of timeline */}
        {!hasNextPage && !isEmpty && !isLoading && (
          <div className="py-4 text-center">
            <div className="mx-auto mb-1 h-px w-8 bg-border" />
            <p className="font-mono text-[10px] text-muted-foreground/60">End</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
};

export default TimelineIndex;
