import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import AppointmentList from '@/components/appointments/AppointmentList';
import AppointmentTypeManager from '@/components/appointments/AppointmentTypeManager';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { List, Settings } from 'lucide-react';
import { useBreadcrumb } from '@/components/layout/PageBreadcrumb';

const AppointmentsPage = () => {
  const [view, setView] = useState('list');
  const { updateBreadcrumbs } = useBreadcrumb();

  // Set breadcrumbs
  useEffect(() => {
    updateBreadcrumbs([
      { label: 'Appointments', path: '/appointments' }
    ]);
  }, [updateBreadcrumbs]);

  return (
    <>
      <Helmet>
        <title>Appointments | Hospital Management System</title>
      </Helmet>

      <div className="flex flex-col space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Appointments</h1>
          <p className="text-muted-foreground">
            View and manage patient appointments and appointment types
          </p>
        </div>

        <Tabs defaultValue={view} onValueChange={setView} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="list" className="flex items-center">
              <List className="mr-2 h-4 w-4" />
              List View
            </TabsTrigger>
            <TabsTrigger value="types" className="flex items-center">
              <Settings className="mr-2 h-4 w-4" />
              Appointment Types
            </TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="mt-6">
            <AppointmentList />
          </TabsContent>

          <TabsContent value="types" className="mt-6">
            <AppointmentTypeManager />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
};

export default AppointmentsPage;
