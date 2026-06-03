import PlusCircle from 'lucide-react/dist/esm/icons/circle-plus.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function EncounterListHeader({
  canFilter = true,
  countExact = true,
  currentPage,
  hasActiveFilters,
  onCreateEncounter,
  onToggleFilters,
  totalCount,
  totalPages,
}) {
  return (
    <header className="bg-card border-b border-border px-6 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-2">
            Clinical Documentation
          </p>
          <h1 className="font-display text-4xl text-foreground tracking-tight">
            Encounters
          </h1>
          <p className="text-muted-foreground mt-2">
            {totalCount}{countExact ? '' : '+'} encounter{totalCount !== 1 ? 's' : ''} found
            {countExact && totalPages > 1 && (
              <span className="font-mono text-xs ml-2">
                (Page {currentPage} of {totalPages})
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canFilter && (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleFilters}
              className={cn("font-mono text-xs", hasActiveFilters && "border-primary text-primary")}
            >
              <Filter className="size-4 mr-2" />
              Filters
              {hasActiveFilters && (
                <span className="ml-2 size-2 rounded-full bg-primary" />
              )}
            </Button>
          )}
          <Button onClick={onCreateEncounter} className="font-mono text-xs">
            <PlusCircle className="size-4 mr-2" />
            New Encounter
          </Button>
        </div>
      </div>
    </header>
  );
}
