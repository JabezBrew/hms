import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { getAuthJSON } from '@/lib/auth-storage';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WardDashboard } from '@/features/wards/components/WardDashboard';
import { SectionManagement } from '@/features/wards/components/SectionManagement';
import { WardStaffManagement } from '@/features/wards/components/WardStaffManagement';
import { useWard, useDeleteWard } from '@/features/wards/hooks/useWardQueries';

import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { useSystemCapabilities } from '@/hooks/useSystemQueries';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * WardDetailPage - Chronicle-style ward detail page
 *
 * Features:
 * - Elegant header with navigation and actions
 * - WardDashboard component for main content
 * - Admin actions (edit/delete)
 */
export default function WardDetailPage() {
  const { wardId } = useParams();
  const navigate = useNavigate();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isAdmin] = useState(() => getAuthJSON('user')?.role === 'admin');
  const { data: deploymentCapabilities } = useSystemCapabilities();
  const enabledFeatures = deploymentCapabilities?.features;
  const canOpenWardBoard = enabledFeatures?.ward_task_board === true
    && enabledFeatures?.patient_chronicle === true
    && enabledFeatures?.wards === true
    && enabledFeatures?.inpatient_admissions === true
    && enabledFeatures?.nursing_workflows === true;

  const {
    data: ward,
    isLoading,
    isError,
    error,
    refetch
  } = useWard(wardId);

  // Show error toast if query fails
  useEffect(() => {
    if (isError) {
      toast.error(error?.message || 'Failed to load ward details');
    }
  }, [isError, error]);

  const pageMeta = usePageMeta({
    title: ward?.name ? `${ward.name} | Hospital Management System` : 'Ward Details | Hospital Management System',
    breadcrumbs: ward
      ? [
          { label: 'Wards', path: '/wards' },
          { label: ward.name, path: `/wards/${wardId}` },
        ]
      : [{ label: 'Wards', path: '/wards' }],
  });

  // Use the delete ward mutation
  const deleteMutation = useDeleteWard();

  // Handle confirm delete
  const handleConfirmDelete = () => {
    deleteMutation.mutate(wardId, {
      onSuccess: () => {
        setShowDeleteDialog(false);
        toast.success('Ward deleted successfully');
        navigate('/wards');
      },
      onError: (err) => {
        setShowDeleteDialog(false);
        setErrorMessage(err.message || 'Failed to delete ward. Please try again.');
        setShowErrorDialog(true);
      }
    });
  };

  // Loading state
  if (isLoading) {
    return (
      <PageState variant="loading">
        {pageMeta}
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
          <div className="flex items-center justify-between">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-48" />
          </div>
          <Skeleton className="h-12 w-64" />
          <div className="grid grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-14 w-full" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <Skeleton key={i} className="h-32" />)}
          </div>
        </div>
      </PageState>
    );
  }

  // Error state
  if (isError) {
    return (
      <PageState
        variant="error"
        title="Unable to load ward"
        description={error?.message || 'Please try again'}
        icon={Building2}
        action={() => refetch()}
      />
    );
  }

  // Not found state
  if (!ward) {
    return (
      <PageState
        variant="empty"
        title="Ward not found"
        description="The requested ward could not be found"
        icon={Building2}
        action={
          <Button variant="outline" onClick={() => navigate('/wards')}>
            <ChevronLeft className="size-4 mr-2" />
            Back to Wards
          </Button>
        }
      />
    );
  }

  return (
    <PageShell>
      {pageMeta}
      <div className="border-b border-border bg-card/50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/wards')}
              className="self-start -ml-2"
            >
              <ChevronLeft className="size-4 mr-1" />
              All Wards
            </Button>
            {(canOpenWardBoard || isAdmin) && (
              <div className="flex flex-wrap gap-2">
                {canOpenWardBoard ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/wards/${wardId}/board`)}
                  >
                    <ClipboardList className="size-4 mr-2" />
                    Ward Board
                  </Button>
                ) : null}
                {isAdmin && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/wards/${wardId}/edit`)}
                    >
                      <Edit className="size-4 mr-2" />
                      Edit Ward
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDeleteDialog(true)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-4 mr-2" />
                      Delete
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <LayoutGrid className="size-4" />
              Ward Overview
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="staff" className="flex items-center gap-2">
                <Users className="size-4" />
                Ward Staff
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger value="sections" className="flex items-center gap-2">
                <Settings className="size-4" />
                Manage Sections
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <WardDashboard />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="staff" className="space-y-6">
              <WardStaffManagement wardId={wardId} />
            </TabsContent>
          )}

          {isAdmin && (
            <TabsContent value="sections" className="space-y-6">
              <SectionManagement wardId={wardId} />
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {ward?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the ward
              and all associated beds. Any active admissions will need to be
              transferred to another ward first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Ward'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Error Dialog */}
      <AlertDialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Error</AlertDialogTitle>
            <AlertDialogDescription>
              {errorMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
