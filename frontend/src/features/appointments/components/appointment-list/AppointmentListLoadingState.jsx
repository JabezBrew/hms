import { Skeleton } from '@/components/ui/skeleton';

const LOADING_ROW_KEYS = ['one', 'two', 'three', 'four', 'five'];

export function AppointmentListLoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-12 w-full rounded-xl" />
      {LOADING_ROW_KEYS.map((key) => (
        <Skeleton key={key} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}
