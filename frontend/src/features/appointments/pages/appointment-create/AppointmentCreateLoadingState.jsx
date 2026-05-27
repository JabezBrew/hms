import { Skeleton } from '@/components/ui/skeleton';
import { PageState } from '@/shared/components/page/PageState';

export function AppointmentCreateLoadingState({ pageMeta }) {
  return (
    <PageState
      variant="loading"
      className="min-h-screen"
    >
      {pageMeta}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-[600px]" />
          <Skeleton className="h-[600px]" />
        </div>
      </div>
    </PageState>
  );
}
