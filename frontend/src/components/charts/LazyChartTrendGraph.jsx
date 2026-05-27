/**
 * LazyChartTrendGraph - Lazy-loaded version of ChartTrendGraph
 *
 * Reduces initial bundle size by code-splitting the recharts library.
 * Recharts adds ~180KB to the bundle, so lazy loading it when charts
 * are first viewed provides significant performance improvements.
 */

import { lazy, Suspense } from 'react';
import DeferredMount from '@/components/ui/DeferredMount';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Lazy load the actual chart component
const ChartTrendGraph = lazy(() => import('./ChartTrendGraph'));

/**
 * Loading skeleton that matches the chart layout
 */
function ChartLoadingSkeleton({ className }) {
  return (
    <div className={cn('border border-border rounded-xl overflow-hidden', className)}>
      {/* Header skeleton */}
      <div className="px-4 py-3 bg-muted/30 border-b border-border">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-9 w-[180px]" />
        </div>
      </div>
      {/* Chart area skeleton */}
      <div className="p-4">
        <Skeleton className="h-[300px] w-full" />
      </div>
      {/* Footer skeleton */}
      <div className="px-4 py-3 bg-muted/30 border-t border-border">
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-12 mb-1" />
              <Skeleton className="h-4 w-8" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * LazyChartTrendGraph wraps ChartTrendGraph with Suspense for code-splitting.
 * Props are passed through to the underlying component.
 */
export function LazyChartTrendGraph(props) {
  return (
    <DeferredMount placeholder={<ChartLoadingSkeleton className={props.className} />}>
      <Suspense fallback={<ChartLoadingSkeleton className={props.className} />}>
        <ChartTrendGraph {...props} />
      </Suspense>
    </DeferredMount>
  );
}

