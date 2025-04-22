import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { usePatient } from '@/hooks/usePatientQueries';
import PatientDetail from '@/components/patients/PatientDetail';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useBreadcrumb } from '@/components/layout/PageBreadcrumb';
import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';

const PatientDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: patient, isLoading, isError, error } = usePatient(id);
  const { updateBreadcrumbs } = useBreadcrumb();

  // Update breadcrumbs when data is loaded
  useEffect(() => {
    if (patient) {
      updateBreadcrumbs([
        { label: 'Patients', path: '/patients' },
        { 
          label: patient.first_name && patient.last_name 
            ? `${patient.first_name} ${patient.last_name}` 
            : `Patient ${id}`, 
          path: `/patients/${id}` 
        }
      ]);
    } else {
      updateBreadcrumbs([
        { label: 'Patients', path: '/patients' },
        { label: 'Patient Details', path: `/patients/${id}` }
      ]);
    }
  }, [patient, id, updateBreadcrumbs]);

  // Show error toast if query fails
  useEffect(() => {
    if (isError) {
      toast.error(error?.message || 'Failed to load patient details');
      console.error('Error loading patient:', error);
    }
  }, [isError, error]);

  const handleBack = () => {
    navigate('/patients');
  };

  const handleEdit = () => {
    navigate(`/patients/${id}/edit`);
  };

  const handleDeleted = () => {
    navigate('/patients');
  };

  return (
    <>
      <Helmet>
        <title>
          {patient 
            ? `${patient.first_name || ''} ${patient.last_name || ''} | Patient Details` 
            : 'Patient Details | HMS'}
        </title>
        <meta name="description" content="View patient details and medical information" />
      </Helmet>

      {isLoading ? (
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
              <TabsList className="grid w-full grid-cols-7">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="medical">Medical Information</TabsTrigger>
                <TabsTrigger value="encounters">Encounters</TabsTrigger>
                <TabsTrigger value="inpatient">Inpatient</TabsTrigger>
                <TabsTrigger value="imaging">Imaging</TabsTrigger>
                <TabsTrigger value="billing">Billing</TabsTrigger>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
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
                      <div className="mt-4">
                        <Skeleton className="h-4 w-24 mb-2" />
                        <Skeleton className="h-16 w-full" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="pb-2">
                    <Skeleton className="h-6 w-40" />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start">
                      <Skeleton className="h-5 w-5 mr-2" />
                      <div>
                        <Skeleton className="h-5 w-24 mb-1" />
                        <Skeleton className="h-4 w-16" />
                      </div>
                    </div>
                    <div className="flex items-start">
                      <Skeleton className="h-5 w-5 mr-2" />
                      <div>
                        <Skeleton className="h-5 w-24 mb-1" />
                        <Skeleton className="h-4 w-48" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      ) : (
        <PatientDetail
          patient={patient}
          onBack={handleBack}
          onEdit={handleEdit}
          onDeleted={handleDeleted}
        />
      )}
    </>
  );
};

export default PatientDetailPage;
