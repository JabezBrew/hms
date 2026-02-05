import { LabTechnicianDashboard } from "@/components/laboratory";
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

/**
 * LabDashboardPage - Lab technician worklist page
 *
 * Simple wrapper page that renders the LabTechnicianDashboard component.
 * This provides a dedicated route for lab technicians to access their worklist.
 */
export default function LabDashboardPage() {
  const pageMeta = usePageMeta({
    title: 'Lab Dashboard | HMS',
    breadcrumbs: [
      { label: 'Laboratory', href: '/laboratory' },
      { label: 'Dashboard' },
    ],
  });

  return (
    <PageShell>
      {pageMeta}
      <LabTechnicianDashboard />
    </PageShell>
  );
}
