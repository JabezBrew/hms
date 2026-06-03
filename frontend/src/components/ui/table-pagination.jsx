import { useEffect, useId, useState } from 'react';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ChevronsLeft from 'lucide-react/dist/esm/icons/chevrons-left.js';
import ChevronsRight from 'lucide-react/dist/esm/icons/chevrons-right.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function formatRange({ currentPage, pageSize, totalCount, countExact, hasNextPage }) {
  const startItem = totalCount > 0 ? ((currentPage - 1) * pageSize) + 1 : 0;
  const knownEnd = Math.min(currentPage * pageSize, totalCount);
  const endItem = countExact ? knownEnd : Math.max(knownEnd, startItem);
  const totalSuffix = countExact ? String(totalCount) : `${totalCount}+`;

  return {
    startItem,
    endItem,
    totalSuffix: hasNextPage && !countExact ? `${totalCount}+` : totalSuffix,
  };
}

/**
 * TablePagination - Reusable pagination component for data tables
 *
 * @param {Object} props
 * @param {number} props.currentPage - Current page number (1-indexed)
 * @param {number} props.totalCount - Total number of items
 * @param {number} props.pageSize - Number of items per page
 * @param {function} props.onPageChange - Callback when page changes: (newPage) => void
 * @param {boolean} [props.countExact=true] - Whether totalCount is an exact server count
 * @param {number} [props.totalPages] - Explicit page count when available
 * @param {boolean} [props.canJumpToPage] - Whether the endpoint supports random page access
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
  countExact = true,
  totalPages,
  canJumpToPage,
  hasNextPage: hasNextPageOverride,
  hasPrevPage: hasPrevPageOverride,
  className,
  itemLabel = 'items',
}) {
  const normalizedPage = normalizePositiveInteger(currentPage, 1);
  const normalizedPageSize = normalizePositiveInteger(pageSize, 25);
  const normalizedTotal = Math.max(0, Number.parseInt(String(totalCount || 0), 10) || 0);
  const exactTotalPages = normalizePositiveInteger(
    totalPages || Math.ceil(normalizedTotal / normalizedPageSize),
    1
  );

  // Use overrides if provided, otherwise calculate from page numbers
  const hasPrevPage = hasPrevPageOverride ?? normalizedPage > 1;
  const hasNextPage = hasNextPageOverride ?? (countExact ? normalizedPage < exactTotalPages : false);
  const hasCursorAvailabilityOverrides = hasNextPageOverride !== undefined || hasPrevPageOverride !== undefined;
  const canRandomAccessPages = canJumpToPage ?? !hasCursorAvailabilityOverrides;
  const { startItem, endItem, totalSuffix } = formatRange({
    currentPage: normalizedPage,
    pageSize: normalizedPageSize,
    totalCount: normalizedTotal,
    countExact,
    hasNextPage,
  });
  const showFirstLast = countExact && canRandomAccessPages;
  const showPageJump = countExact && canRandomAccessPages && exactTotalPages > 2;
  const pageJumpId = useId();
  const [pageInput, setPageInput] = useState(String(normalizedPage));

  useEffect(() => {
    setPageInput(String(normalizedPage));
  }, [normalizedPage]);

  const handleJumpSubmit = (event) => {
    event.preventDefault();
    const requestedPage = normalizePositiveInteger(pageInput, normalizedPage);
    const boundedPage = Math.min(Math.max(requestedPage, 1), exactTotalPages);
    setPageInput(String(boundedPage));
    if (boundedPage !== normalizedPage) {
      onPageChange(boundedPage);
    }
  };

  if (normalizedTotal === 0) {
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
        <span className="font-medium text-foreground">{totalSuffix}</span> {itemLabel}
      </p>
      <div className="flex items-center gap-1">
        {/* First page */}
        {showFirstLast && (
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => onPageChange(1)}
            disabled={normalizedPage === 1}
            aria-label="Go to first page"
          >
            <ChevronsLeft className="size-4" />
          </Button>
        )}
        {/* Previous page */}
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(normalizedPage - 1)}
          disabled={!hasPrevPage}
          aria-label="Go to previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        {/* Page indicator */}
        <span className="px-3 text-sm text-muted-foreground">
          Page <span className="font-medium text-foreground">{normalizedPage}</span>
          {countExact ? (
            <>
              {' '}of <span className="font-medium text-foreground">{exactTotalPages}</span>
            </>
          ) : hasNextPage ? (
            <span> · More available</span>
          ) : null}
        </span>
        {/* Next page */}
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(normalizedPage + 1)}
          disabled={!hasNextPage}
          aria-label="Go to next page"
        >
          <ChevronRight className="size-4" />
        </Button>
        {/* Last page */}
        {showFirstLast && (
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => onPageChange(exactTotalPages)}
            disabled={normalizedPage === exactTotalPages || exactTotalPages === 0}
            aria-label="Go to last page"
          >
            <ChevronsRight className="size-4" />
          </Button>
        )}
        {showPageJump && (
          <form className="ml-2 flex items-center gap-2" onSubmit={handleJumpSubmit}>
            <label htmlFor={pageJumpId} className="sr-only">Go to page</label>
            <Input
              id={pageJumpId}
              type="number"
              min="1"
              max={exactTotalPages}
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={() => {
                if (!pageInput) {
                  setPageInput(String(normalizedPage));
                }
              }}
              className="h-8 w-20 px-2 text-center font-mono text-xs"
            />
            <Button type="submit" variant="outline" size="sm" className="h-8 font-mono text-xs">
              Go
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
