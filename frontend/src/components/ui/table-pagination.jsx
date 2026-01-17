import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ChevronsLeft from 'lucide-react/dist/esm/icons/chevrons-left.js';
import ChevronsRight from 'lucide-react/dist/esm/icons/chevrons-right.js';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * TablePagination - Reusable pagination component for data tables
 *
 * @param {Object} props
 * @param {number} props.currentPage - Current page number (1-indexed)
 * @param {number} props.totalCount - Total number of items
 * @param {number} props.pageSize - Number of items per page
 * @param {function} props.onPageChange - Callback when page changes: (newPage) => void
 * @param {boolean} [props.hasNextPage] - Override for next page availability (for cursor-based pagination)
 * @param {boolean} [props.hasPrevPage] - Override for prev page availability (for cursor-based pagination)
 * @param {string} [props.className] - Additional class names
 * @param {string} [props.itemLabel='items'] - Label for items (e.g., 'logs', 'patients', 'records')
 */
export function TablePagination({
  currentPage,
  totalCount,
  pageSize,
  onPageChange,
  hasNextPage: hasNextPageOverride,
  hasPrevPage: hasPrevPageOverride,
  className,
  itemLabel = 'items',
}) {
  const totalPages = Math.ceil(totalCount / pageSize);
  const startItem = totalCount > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const endItem = Math.min(currentPage * pageSize, totalCount);

  // Use overrides if provided, otherwise calculate from page numbers
  const hasPrevPage = hasPrevPageOverride ?? currentPage > 1;
  const hasNextPage = hasNextPageOverride ?? currentPage < totalPages;

  if (totalCount === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row items-center justify-between gap-4 py-4 border-t border-border',
        className
      )}
    >
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{startItem}</span> to{' '}
        <span className="font-medium text-foreground">{endItem}</span> of{' '}
        <span className="font-medium text-foreground">{totalCount}</span> {itemLabel}
      </p>
      <div className="flex items-center gap-1">
        {/* First page */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          aria-label="Go to first page"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        {/* Previous page */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={!hasPrevPage}
          aria-label="Go to previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {/* Page indicator */}
        <span className="px-3 text-sm text-muted-foreground">
          Page <span className="font-medium text-foreground">{currentPage}</span> of{' '}
          <span className="font-medium text-foreground">{totalPages || 1}</span>
        </span>
        {/* Next page */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={!hasNextPage}
          aria-label="Go to next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {/* Last page */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages || totalPages === 0}
          aria-label="Go to last page"
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
