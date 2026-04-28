import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { patientsApi } from '@/features/patients/api';
import PatientForm from '@/components/patients/PatientForm';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const PatientEditPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPatient = async () => {
      try {
        const data = await patientsApi.getPatient(id);
        setPatient(data);
      } catch (error) {
        toast.error('Failed to load patient details');
        console.error('Error loading patient:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPatient();
  }, [id]);

  const handleSuccess = (updatedPatient) => {
    toast.success('Patient updated successfully');
    navigate(`/patients/${id}`);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="max-w-4xl mx-auto">
          <Card className="w-full">
            <CardHeader>
              <CardTitle><Skeleton className="h-7 w-32" /></CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="identity">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="identity">Identity</TabsTrigger>
                  <TabsTrigger value="contact">Contact</TabsTrigger>
                  <TabsTrigger value="review">Review</TabsTrigger>
                </TabsList>

                <TabsContent value="identity" className="space-y-4 mt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Skeleton className="h-4 w-24 mb-2" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                    <div>
                      <Skeleton className="h-4 w-24 mb-2" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  </div>

                  <div>
                    <Skeleton className="h-4 w-28 mb-2" />
                    <Skeleton className="h-10 w-full" />
                  </div>

                  <div>
                    <Skeleton className="h-4 w-16 mb-2" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </TabsContent>
              </Tabs>

              <div className="flex justify-end pt-4">
                <Skeleton className="h-10 w-32" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <button 
          className="text-sm text-muted-foreground hover:text-foreground flex items-center"
          onClick={() => navigate(`/patients/${id}`)}
        >
          ← Back to Patient Details
        </button>
      </div>
      <div className="max-w-4xl mx-auto">
        <PatientForm 
          patient={patient} 
          onSuccess={handleSuccess} 
        />
      </div>
    </div>
  );
};

export default PatientEditPage;
