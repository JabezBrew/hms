import { TablePagination } from '@/components/ui/table-pagination';
import { ENCOUNTER_PAGE_SIZE } from './encounterListConstants';

export function EncounterPagination({
  canJumpToPage,
  countExact,
  currentPage,
  hasNextPage,
  hasPrevPage,
  isLoading,
  onGoToPage,
  totalCount,
  totalPages,
}) {
  if (isLoading) {
    return null;
  }

  return (
    <TablePagination
      currentPage={currentPage}
      totalCount={totalCount}
      pageSize={ENCOUNTER_PAGE_SIZE}
      totalPages={totalPages}
      countExact={countExact}
      hasNextPage={hasNextPage}
      hasPrevPage={hasPrevPage}
      canJumpToPage={canJumpToPage && countExact}
      onPageChange={onGoToPage}
      itemLabel="encounters"
      className="mt-6"
    />
  );
}
