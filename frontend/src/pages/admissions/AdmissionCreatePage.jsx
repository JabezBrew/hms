import { useLocation, useNavigate } from 'react-router-dom';
import { BreadcrumbSetter } from '@/components/layout/PageBreadcrumb';
import { AdmissionForm } from '@/components/wards/AdmissionForm';
import { Button } from '@/components/ui/button';
import { ChevronLeft, UserPlus, Building2 } from 'lucide-react';
import { useWard } from '@/hooks/useWardQueries';

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

  const handleBack = () => {
    if (wardId) {
      navigate(`/wards/${wardId}`);
    } else {
      navigate('/wards');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <BreadcrumbSetter breadcrumbs={breadcrumbs} />

      {/* Page Header */}
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
            <div className="flex-1">
              <h1 className="font-display text-3xl md:text-4xl text-foreground tracking-tight">
                New Patient Admission
              </h1>
              <p className="text-muted-foreground mt-1 font-mono text-sm">
                {ward ? (
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
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <AdmissionForm wardId={wardId} wardData={ward} />
      </div>
    </div>
  );
}
