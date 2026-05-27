import { Skeleton } from '@/components/ui/skeleton';

export function ChronicleLoadingState({ pageMeta }) {
  return (
    <>
      {pageMeta}
      <div className="min-h-screen bg-background">
        <div className="bg-card border-b border-border px-6 py-8">
          <Skeleton className="h-12 w-64 mb-4" />
          <Skeleton className="h-4 w-96 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>

        <div className="flex">
          <div className="w-80 border-r border-border p-6 space-y-6">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className="flex-1 p-6 space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    </>
  );
}
