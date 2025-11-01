import { WardOccupancyReports } from '@/components/reports/WardOccupancyReports';
import { PageBreadcrumb } from '@/components/layout/PageBreadcrumb';

export default function WardReportsPage() {
  return (
    <div className="space-y-6">
      <PageBreadcrumb
        items={[
          { label: 'Wards', href: '/wards' },
          { label: 'Reports', href: '/wards/reports' }
        ]}
      />

      <WardOccupancyReports />
    </div>
  );
}
