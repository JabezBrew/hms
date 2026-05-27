import { Skeleton } from '@/components/ui/skeleton';

export function AppointmentDetailLoadingState() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="bg-card border-b border-border px-6 py-8 rounded-xl">
        <Skeleton className="h-10 w-[350px] mb-4" />
        <div className="flex gap-4">
          <Skeleton className="h-5 w-[150px]" />
          <Skeleton className="h-5 w-[120px]" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Skeleton className="h-[200px] w-full rounded-xl" />
        </div>
        <Skeleton className="h-[300px] w-full rounded-xl" />
      </div>
    </div>
  );
}
