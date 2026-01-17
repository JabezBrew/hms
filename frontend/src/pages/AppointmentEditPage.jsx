import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import AppointmentForm from '@/components/appointments/AppointmentForm';
import { Button } from '@/components/ui/button';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { fetchAppointment } from '@/lib/api.js';

const AppointmentEditPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Load appointment data
  useEffect(() => {
    const loadAppointment = async () => {
      try {
        const data = await fetchAppointment(id);
        
        // Extract patient and practitioner IDs from participants
        const patientParticipant = data.participant?.find(p => 
          p.actor?.reference?.startsWith('Patient/'));
        const practitionerParticipant = data.participant?.find(p => 
          p.actor?.reference?.startsWith('Practitioner/'));
        
        const patientId = patientParticipant?.actor?.reference?.split('/')[1] || '';
        const practitionerId = practitionerParticipant?.actor?.reference?.split('/')[1] || '';
        
        // Extract appointment type ID (this would need to be mapped to your local ID)
        const appointmentTypeId = ''; // This would need to be determined based on your data model
        
        // Format data for the form
        const formattedData = {
          patientId,
          practitionerId,
          appointmentTypeId,
          date: data.start,
          description: data.description || '',
          comment: data.comment || '',
        };
        
        setAppointment(formattedData);
      } catch (error) {
        console.error('Error loading appointment:', error);
        toast({
          title: 'Error',
          description: 'Failed to load appointment details',
          variant: 'destructive',
        });
        navigate('/appointments');
      } finally {
        setLoading(false);
      }
    };
    
    loadAppointment();
  }, [id, navigate, toast]);
  
  // Handle successful appointment update
  const handleSuccess = (updatedAppointment) => {
    navigate(`/appointments/${updatedAppointment.id}`);
  };
  
  // Handle back navigation
  const handleBack = () => {
    navigate(`/appointments/${id}`);
  };
  
  return (
    <>
      <Helmet>
        <title>Edit Appointment | Hospital Management System</title>
      </Helmet>
      
      <div className="space-y-6">
        <Button variant="ghost" onClick={handleBack} className="pl-0">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Appointment Details
        </Button>
        
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edit Appointment</h1>
          <p className="text-muted-foreground">
            Update the details of this appointment
          </p>
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle>Appointment Details</CardTitle>
            <CardDescription>
              Modify the appointment information below
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : (
              <AppointmentForm 
                initialData={appointment} 
                onSuccess={handleSuccess}
                isEditing={true}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default AppointmentEditPage;