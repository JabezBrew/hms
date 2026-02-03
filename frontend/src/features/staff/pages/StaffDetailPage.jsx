import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useStaffMember, usePractitioners } from '@/hooks/useStaffQueries';
import StaffDetail from '@/components/staff/StaffDetail';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';

const StaffDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  // Use React Query hooks for data fetching
  const {
    data: staff,
    isLoading: isStaffLoading,
    isError: isStaffError,
    error: staffError
  } = useStaffMember(id);

  // Get practitioners list to find the practitioner profile for this staff member
  const {
    data: practitioners,
    isLoading: isPractitionersLoading
  } = usePractitioners();

  // Find the practitioner profile for this staff member
  const practitioner = practitioners?.find(p => p.staff === id);

  // Determine overall loading state
  const loading = isStaffLoading || isPractitionersLoading;

  // Show error toast if staff query fails
  useEffect(() => {
    if (isStaffError) {
      toast.error(staffError?.message || 'Failed to load staff details');
      console.error('Error loading staff:', staffError);
    }
  }, [isStaffError, staffError]);

  const handleBack = () => {
    navigate('/staff');
  };

  const handleDeleted = () => {
    navigate('/staff');
  };

  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <div className="flex flex-col">
              <Button variant="outline" size="sm" className="mb-2 w-fit">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <div className="flex items-center pl-0">
                <Skeleton className="h-12 w-12 rounded-full mr-4" />
                <div>
                  <Skeleton className="h-8 w-48 mb-2" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
            </div>
          </div>
          <div className="flex space-x-2">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-24" />
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="overview">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <Skeleton className="h-6 w-40" />
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-28" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <Skeleton className="h-6 w-40" />
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-36" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    );
  }

  return (
    <StaffDetail
      staff={staff}
      practitioner={practitioner}
      onBack={handleBack}
      onDeleted={handleDeleted}
    />
  );
};

export default StaffDetailPage;
