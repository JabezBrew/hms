import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { AdmissionForm } from '@/components/wards/AdmissionForm';
import { Button } from '@/components/ui/button';

import { useWard } from '@/features/wards/hooks/useWardQueries';

/**
 * AdmissionCreatePage - Chronicle-style patient admission page
 *
 * Features:
 * - Editorial header with ward context
 * - Guided admission workflow
 * - Pre-selected ward when navigating from ward page
 */
export default function AdmissionCreatePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const wardId = location.state?.wardId;

  // Fetch ward details only if wardId is provided (for display purposes)
  const { data: ward } = useWard(wardId, { enabled: !!wardId });

  // Build breadcrumbs based on context
  const breadcrumbs = wardId && ward
    ? [
        { label: 'Wards', path: '/wards' },
        { label: ward.name, path: `/wards/${wardId}` },
        { label: 'New Admission' }
      ]
    : [
        { label: 'Wards', path: '/wards' },
        { label: 'New Admission' }
      ];

  const pageMeta = usePageMeta({
    title: 'New Admission | Hospital Management System',
    breadcrumbs,
  });

  const handleBack = () => {
    if (wardId) {
      navigate(`/wards/${wardId}`);
    } else {
      navigate('/wards');
    }
  };

  return (
    <PageShell>
      {pageMeta}
      <div className="border-b border-border bg-card/50">
        <div className="max-w-4xl mx-auto px-6 py-6">
          {/* Back Navigation */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="mb-4 -ml-2 font-mono text-xs"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            {wardId ? 'Back to Ward' : 'All Wards'}
          </Button>

          {/* Title Section */}
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <UserPlus className="h-6 w-6 text-primary" />
            </div>
            <PageHeader
              title="New Patient Admission"
              description={ward ? (
                <span className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Admitting to <span className="text-foreground font-medium">{ward.name}</span>
                  <span className="text-muted-foreground">
                    ({ward.available_beds_count} beds available)
                  </span>
                </span>
              ) : (
                'Select a patient and assign a bed'
              )}
              size="md"
              wrap={false}
              className="border-none bg-transparent p-0"
              contentClassName="items-start"
              titleClassName="text-3xl md:text-4xl"
              descriptionClassName="mt-1 font-mono text-sm"
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <AdmissionForm wardId={wardId} wardData={ward} />
      </div>
    </PageShell>
  );
}
