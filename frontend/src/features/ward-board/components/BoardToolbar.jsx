import PanelRightOpen from 'lucide-react/dist/esm/icons/panel-right-open.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { BOARD_VIEWS, PAGE_SIZE_OPTIONS } from './wardBoardUtils';

export function BoardToolbar({
  view,
  searchValue,
  wardValue,
  fixedWard,
  pageSize,
  isFetching,
  onViewChange,
  onSearchChange,
  onWardChange,
  onPageSizeChange,
  onClearFilters,
  onRefresh,
  onOpenSummary,
  className,
}) {
  const hasFilters = Boolean(searchValue || (!fixedWard && wardValue));

  return (
    <section className={cn('border-b border-border bg-card/50 px-4 py-4 sm:px-6', className)}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="ward-board-search"
              type="search"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search patient, bed, MRN, task..."
              className="h-10 pl-10 font-mono text-sm"
              aria-label="Search ward board"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="sr-only" htmlFor="ward-board-ward">
              Ward
            </label>
            <Input
              id="ward-board-ward"
              value={wardValue}
              onChange={(event) => onWardChange(event.target.value)}
              disabled={Boolean(fixedWard)}
              placeholder="Ward"
              className="h-10 w-full font-mono text-sm sm:w-36"
            />

            <label className="sr-only" htmlFor="ward-board-page-size">
              Page size
            </label>
            <select
              id="ward-board-page-size"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="h-10 rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} rows
                </option>
              ))}
            </select>

            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={onClearFilters} className="font-mono text-xs">
                <X className="h-4 w-4" aria-hidden="true" />
                Clear
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onRefresh}
              disabled={isFetching}
              aria-label="Refresh ward board"
              title="Refresh ward board"
            >
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} aria-hidden="true" />
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onOpenSummary} className="font-mono text-xs">
              <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
              Summary
            </Button>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Ward board views">
          {BOARD_VIEWS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={view === item.value}
              className={cn(
                'min-h-9 shrink-0 rounded-md border px-3 py-2 font-mono text-xs transition-colors',
                view === item.value
                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted/60'
              )}
              onClick={() => onViewChange(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
