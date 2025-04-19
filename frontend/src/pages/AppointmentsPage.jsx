import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import AppointmentList from '@/components/appointments/AppointmentList';
import AppointmentCalendar from '@/components/appointments/AppointmentCalendar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CalendarDays, List } from 'lucide-react';

const AppointmentsPage = () => {
  const [view, setView] = useState('list');

  return (
    <>
      <Helmet>
        <title>Appointments | Hospital Management System</title>
      </Helmet>
      
      <div className="flex flex-col space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Appointments</h1>
          <p className="text-muted-foreground">
            View and manage patient appointments
          </p>
        </div>
        
        <Tabs defaultValue={view} onValueChange={setView} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="list" className="flex items-center">
              <List className="mr-2 h-4 w-4" />
              List View
            </TabsTrigger>
            <TabsTrigger value="calendar" className="flex items-center">
              <CalendarDays className="mr-2 h-4 w-4" />
              Calendar View
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="list" className="mt-6">
            <AppointmentList />
          </TabsContent>
          
          <TabsContent value="calendar" className="mt-6">
            <AppointmentCalendar />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
};

export default AppointmentsPage;