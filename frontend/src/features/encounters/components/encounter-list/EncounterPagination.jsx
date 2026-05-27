import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronsLeft from 'lucide-react/dist/esm/icons/chevrons-left.js';
import ChevronsRight from 'lucide-react/dist/esm/icons/chevrons-right.js';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ENCOUNTER_PAGE_SIZE } from './encounterListConstants';
import { getEncounterPageNumbers } from './encounterListUtils';

export function EncounterPagination({
  currentPage,
  hasNextPage,
  hasPrevPage,
  isLoading,
  onGoToPage,
  totalCount,
  totalPages,
}) {
  if (totalPages <= 1 || isLoading) {
    return null;
  }

  const pageNumbers = getEncounterPageNumbers({ currentPage, totalPages });

  return (
    <div className="flex items-center justify-between border-t border-border pt-6 mt-6">
      <div className="text-sm text-muted-foreground font-mono">
        Showing {((currentPage - 1) * ENCOUNTER_PAGE_SIZE) + 1} to {Math.min(currentPage * ENCOUNTER_PAGE_SIZE, totalCount)} of {totalCount} encounters
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onGoToPage(1)}
          disabled={!hasPrevPage}
          className="font-mono text-xs"
        >
          <ChevronsLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onGoToPage(currentPage - 1)}
          disabled={!hasPrevPage}
          className="font-mono text-xs"
        >
          <ChevronLeft className="size-4" />
          Previous
        </Button>
        <div className="flex items-center gap-1 mx-2">
          {pageNumbers.map((pageNumber) => (
            <Button
              key={pageNumber}
              variant={currentPage === pageNumber ? "default" : "outline"}
              size="sm"
              onClick={() => onGoToPage(pageNumber)}
              className={cn(
                "font-mono text-xs size-8 p-0",
                currentPage === pageNumber && "pointer-events-none"
              )}
            >
              {pageNumber}
            </Button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onGoToPage(currentPage + 1)}
          disabled={!hasNextPage}
          className="font-mono text-xs"
        >
          Next
          <ChevronRight className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onGoToPage(totalPages)}
          disabled={!hasNextPage}
          className="font-mono text-xs"
        >
          <ChevronsRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
