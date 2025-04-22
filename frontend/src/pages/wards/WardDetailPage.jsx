import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WardDashboard } from '@/components/wards/WardDashboard';
import { useWard, useDeleteWard } from '@/hooks/useWardQueries';
import { ChevronLeft, Edit, Trash2 } from 'lucide-react';
import { BreadcrumbSetter } from '@/components/layout/PageBreadcrumb';
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

export default function WardDetailPage() {
  const { wardId } = useParams();
  const navigate = useNavigate();
  const { 
    data: ward, 
    isLoading, 
    isError, 
    error 
  } = useWard(wardId);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Show error toast if query fails
  useEffect(() => {
    if (isError) {
      toast.error(error?.message || 'Failed to load ward details');
      console.error('Error loading ward:', error);
    }
  }, [isError, error]);

  // Handle edit ward
  const handleEditWard = () => {
    navigate(`/wards/${wardId}/edit`);
  };

  // Handle delete ward button click
  const handleDeleteWardClick = () => {
    setShowDeleteDialog(true);
  };

  // Use the delete ward mutation
  const deleteMutation = useDeleteWard();

  // Handle actual ward deletion
  const handleConfirmDelete = () => {
    deleteMutation.mutate(wardId, {
      onSuccess: () => {
        setShowDeleteDialog(false);
        toast.success('Ward deleted successfully');
        navigate('/wards');
      },
      onError: (err) => {
        console.error('Error deleting ward:', err);
        setShowDeleteDialog(false);
        setErrorMessage(err.message || 'Failed to delete ward. Please try again.');
        setShowErrorDialog(true);
      }
    });
  };

  // Set breadcrumb when ward data is loaded
  useEffect(() => {
    if (ward) {
      setBreadcrumbs([
        { label: 'Wards', path: '/wards' },
        { label: ward.name, path: `/wards/${wardId}` }
      ]);
    }
  }, [ward, wardId]);

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="container mx-auto py-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-red-500">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error?.message || 'Failed to load ward details. Please try again.'}</p>
            <Button 
              variant="outline" 
              className="mt-4"
              onClick={() => window.location.reload()}
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!ward) {
    return (
      <div className="container mx-auto py-6">
        <Card>
          <CardHeader>
            <CardTitle>Ward Not Found</CardTitle>
          </CardHeader>
          <CardContent>
            <p>The requested ward could not be found.</p>
            <Button 
              variant="outline" 
              className="mt-4"
              onClick={() => navigate('/wards')}
            >
              Back to Wards
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Set breadcrumb navigation */}
      <BreadcrumbSetter breadcrumbs={breadcrumbs} />


      {/* Action buttons */}
      <div className="flex justify-between items-center">
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => navigate('/wards')}
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to Wards
        </Button>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleEditWard}
          >
            <Edit className="h-4 w-4 mr-2" />
            Edit Ward
          </Button>
          <Button 
            variant="destructive" 
            size="sm"
            onClick={handleDeleteWardClick}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Ward
          </Button>
        </div>
      </div>

      {/* Ward Dashboard */}
      <WardDashboard />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the ward
              and all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
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
    </div>
  );
}
