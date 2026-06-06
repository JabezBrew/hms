import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { BOARD_VIEWS, PAGE_SIZE_OPTIONS } from './wardBoardUtils';

const EMPTY_ASSIGNED_WARDS = [];

export function BoardToolbar({
  view,
  searchValue,
  patientValue,
  wardValue,
  assignedWards = EMPTY_ASSIGNED_WARDS,
  currentWardId,
  fixedWard,
  pageSize,
  isFetching,
  searchEnabled = true,
  lockWardSelector = false,
  handoverActive = false,
  summary,
  onViewChange,
  onSearchChange,
  onWardChange,
  onAssignedWardChange,
  onPageSizeChange,
  onClearFilters,
  onRefresh,
  onOpenSummary,
  onHandoverMode,
  className,
}) {
  const assignedWardOptions = Array.isArray(assignedWards)
    ? assignedWards.filter((assignment) => assignment?.ward_id)
    : [];
  const hasAssignedWardSwitcher = !lockWardSelector && assignedWardOptions.length > 1;
  const hasCurrentWardOption = !currentWardId
    || assignedWardOptions.some((assignment) => assignment.ward_id === currentWardId);
  const hasFilters = Boolean(
    (searchEnabled && searchValue) || patientValue || (!fixedWard && !lockWardSelector && !hasAssignedWardSwitcher && wardValue)
  );

  const viewCounts = {
    'results': summary?.pendingResults,
    'discharge': summary?.dischargeReady,
    'my-work': summary?.myWork,
  };

  return (
    <div className={cn('sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur-sm', className)}>
      <div className="flex min-h-12 flex-wrap items-center gap-3 px-4 py-2 sm:px-6">
        {searchEnabled && (
          <div className="relative min-w-0 flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="ward-board-search"
              type="search"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search patient, bed, MRN or task..."
              className="h-8 pl-8 font-mono text-xs"
              aria-label="Search ward board"
            />
            {searchValue ? (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>
        )}

        {hasAssignedWardSwitcher ? (
          <div className="relative shrink-0">
            <label className="sr-only" htmlFor="ward-board-assigned-ward">Assigned ward</label>
            <select
              id="ward-board-assigned-ward"
              value={currentWardId || ''}
              onChange={(event) => onAssignedWardChange?.(event.target.value)}
              className="h-8 min-w-40 appearance-none rounded-md border border-input bg-background pl-3 pr-7 font-mono text-xs text-foreground shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              {!hasCurrentWardOption ? (
                <option value={currentWardId}>{wardValue || 'Current ward'}</option>
              ) : null}
              {assignedWardOptions.map((assignment) => (
                <option key={assignment.assignment_id || assignment.ward_id} value={assignment.ward_id}>
                  {assignment.ward_name || 'Assigned ward'}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          </div>
        ) : null}

        {!hasAssignedWardSwitcher && !fixedWard && !lockWardSelector ? (
          <div className="relative shrink-0">
            <label className="sr-only" htmlFor="ward-board-ward">Ward</label>
            <select
              id="ward-board-ward"
              value={wardValue}
              onChange={(event) => onWardChange(event.target.value)}
              className="h-8 appearance-none rounded-md border border-input bg-background pl-3 pr-7 font-mono text-xs text-foreground shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <option value="">Ward scope</option>
              <option value={wardValue || ''}>{wardValue || 'Select ward…'}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant={handoverActive ? 'secondary' : 'outline'}
            size="sm"
            onClick={onHandoverMode}
            className="h-8 gap-1.5 font-mono text-xs"
          >
            <ClipboardList className="size-3.5" aria-hidden="true" />
            Handover
          </Button>

          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-8 px-2 font-mono text-xs text-muted-foreground">
              <X className="size-3.5" aria-hidden="true" />
              Clear
            </Button>
          ) : null}

          <label className="sr-only" htmlFor="ward-board-page-size">Rows per page</label>
          <select
            id="ward-board-page-size"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground shadow-xs focus-visible:border-ring focus-visible:outline-none"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>{size} rows</option>
            ))}
          </select>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={isFetching}
            aria-label="Refresh ward board"
            className="size-8"
          >
            {isFetching ? (
              <LoadingSpinner className="h-3.5 w-7" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onOpenSummary}
            aria-label="Board summary"
            className="size-8"
          >
            <Settings2 className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-0 overflow-x-auto border-t border-border/60" role="tablist" aria-label="Ward board views">
        {BOARD_VIEWS.map((item) => {
          const count = viewCounts[item.value];
          const active = view === item.value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                'relative flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-4 font-mono text-xs transition-colors',
                active
                  ? 'border-amber-500 text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
              onClick={() => onViewChange(item.value)}
            >
              {item.label}
              {count != null && count > 0 ? (
                <span
                  className={cn(
                    'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] leading-none',
                    active ? 'bg-amber-100 text-amber-700' : 'bg-muted text-muted-foreground'
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
