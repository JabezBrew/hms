import { TablePagination } from '@/components/ui/table-pagination';

export function AppointmentListPagination({
  canJumpToPage,
  countExact,
  hasNextPage,
  page,
  pageSize,
  setPage,
  totalCount,
  totalPages,
}) {
  return (
    <TablePagination
      currentPage={page}
      totalCount={totalCount}
      pageSize={pageSize}
      totalPages={totalPages}
      countExact={countExact}
      hasNextPage={hasNextPage}
      hasPrevPage={page > 1}
      canJumpToPage={canJumpToPage && countExact}
      onPageChange={setPage}
      itemLabel="appointments"
      className="border-t-0 pt-0"
    />
  );
}
