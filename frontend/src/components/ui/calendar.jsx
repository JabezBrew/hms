
import { lazy, Suspense } from 'react';
import { Skeleton } from "@/components/ui/skeleton"

const CalendarImpl = lazy(() => import("./calendar-impl"))

function Calendar(props) {
  return (
    <Suspense fallback={<Skeleton className="h-[280px] w-full" />}>
      <CalendarImpl {...props} />
    </Suspense>
  )
}

export { Calendar }
