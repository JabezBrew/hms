import { useEffect } from 'react';
import { TablePagination } from '@/components/ui/table-pagination';

export function InventoryPagination({
  canJumpToPage = false,
  data,
  itemLabel,
  onPageChange,
  page,
  pageSize,
}) {
  const results = Array.isArray(data) ? data : (Array.isArray(data?.results) ? data.results : []);
  const currentPage = Number(data?.page || page || 1);
  const totalCount = Number(data?.count ?? data?.total ?? results.length);
  const countExact = data?.count_exact !== false && data?.total_is_lower_bound !== true;
  const hasNextPage = Boolean(data?.next);
  const totalPages = Number(data?.total_pages)
    || (countExact
      ? Math.max(1, Math.ceil(totalCount / pageSize))
      : Math.max(1, currentPage + (hasNextPage ? 1 : 0)));

  useEffect(() => {
    if (
      data?.cursor_missing
      && Number(data?.requested_page || page || 1) !== currentPage
      && typeof onPageChange === 'function'
    ) {
      onPageChange(currentPage);
    }
  }, [currentPage, data?.cursor_missing, data?.requested_page, onPageChange, page]);

  return (
    <TablePagination
      currentPage={currentPage}
      totalCount={totalCount}
      pageSize={pageSize}
      totalPages={totalPages}
      countExact={countExact}
      hasNextPage={hasNextPage}
      hasPrevPage={currentPage > 1}
      canJumpToPage={canJumpToPage && countExact}
      onPageChange={onPageChange}
      itemLabel={itemLabel}
    />
  );
}
