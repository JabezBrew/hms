import { useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import AppointmentForm from '@/components/appointments/AppointmentForm';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const AppointmentCreatePage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get any initial data passed via location state
  const initialData = location.state || {};
  
  // Handle successful appointment creation
  const handleSuccess = (appointment) => {
    navigate(`/appointments/${appointment.id}`);
  };
  
  // Handle back navigation
  const handleBack = () => {
    navigate('/appointments');
  };
  
  return (
    <>
      <Helmet>
        <title>Create Appointment | Hospital Management System</title>
      </Helmet>
      
      <div className="space-y-6">
        <Button variant="ghost" onClick={handleBack} className="pl-0">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Appointments
        </Button>
        
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create Appointment</h1>
          <p className="text-muted-foreground">
            Schedule a new appointment for a patient
          </p>
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle>Appointment Details</CardTitle>
            <CardDescription>
              Fill in the details for the new appointment
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AppointmentForm 
              initialData={initialData} 
              onSuccess={handleSuccess} 
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default AppointmentCreatePage;