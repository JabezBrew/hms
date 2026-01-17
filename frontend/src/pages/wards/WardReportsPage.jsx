import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import BarChart3 from 'lucide-react/dist/esm/icons/chart-column.js';
import { lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { BreadcrumbSetter } from '@/components/layout/PageBreadcrumb';

// Lazy load chart-heavy reports component to reduce initial bundle size
const WardOccupancyReports = lazy(() =>
  import('@/components/reports/WardOccupancyReports').then(m => ({ default: m.WardOccupancyReports }))
);

// Loading skeleton for reports
const ReportsLoadingFallback = () => (
  <div className="space-y-6">
    <div className="flex gap-4">
      <Skeleton className="h-32 flex-1" />
      <Skeleton className="h-32 flex-1" />
      <Skeleton className="h-32 flex-1" />
    </div>
    <Skeleton className="h-64 w-full" />
    <Skeleton className="h-48 w-full" />
  </div>
);

/**
 * WardReportsPage - Chronicle-style ward reports page
 *
 * Features:
 * - Editorial header with icon and typography
 * - Comprehensive ward analytics
 * - Export capabilities
 */
export default function WardReportsPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <BreadcrumbSetter
        breadcrumbs={[
          { label: 'Wards', path: '/wards' },
          { label: 'Reports' }
        ]}
      />

      {/* Page Header */}
      <div className="border-b border-border bg-card/50">
        <div className="max-w-7xl mx-auto px-6 py-6">
          {/* Back Navigation */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/wards')}
            className="mb-4 -ml-2 font-mono text-xs"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Wards
          </Button>

          {/* Title Section */}
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <BarChart3 className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <h1 className="font-display text-3xl md:text-4xl text-foreground tracking-tight">
                Ward Occupancy Reports
              </h1>
              <p className="text-muted-foreground mt-1 font-mono text-sm">
                Analytics on occupancy rates, length of stay, and ward utilization
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <Suspense fallback={<ReportsLoadingFallback />}>
          <WardOccupancyReports />
        </Suspense>
      </div>
    </div>
  );
}
