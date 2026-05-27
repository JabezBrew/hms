import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';

import { Button } from '@/components/ui/button';

export function AppointmentListPagination({ page, setPage, totalPages }) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between">
      <p className="font-mono text-xs text-muted-foreground">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((previousPage) => Math.max(previousPage - 1, 1))}
          disabled={page === 1}
          className="font-mono text-xs"
        >
          <ChevronLeft className="mr-1 size-4" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((previousPage) => Math.min(previousPage + 1, totalPages))}
          disabled={page === totalPages}
          className="font-mono text-xs"
        >
          Next
          <ChevronRight className="ml-1 size-4" />
        </Button>
      </div>
    </div>
  );
}
