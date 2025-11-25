import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { cn } from '@/lib/utils';
import AppointmentList from '@/components/appointments/AppointmentList';
import AppointmentTypeManager from '@/components/appointments/AppointmentTypeManager';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar, Settings } from 'lucide-react';
import { useBreadcrumb } from '@/components/layout/PageBreadcrumb';

const AppointmentsPage = () => {
  const [view, setView] = useState('list');
  const { updateBreadcrumbs } = useBreadcrumb();

  // Set breadcrumbs
  useEffect(() => {
    updateBreadcrumbs([
      { label: 'Schedule', path: '/appointments' }
    ]);
  }, [updateBreadcrumbs]);

  const todayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

  return (
    <>
      <Helmet>
        <title>Schedule | Hospital Management System</title>
      </Helmet>

      <div className="min-h-screen bg-background">
        {/* Page Header */}
        <header className="bg-card border-b border-border px-6 py-8">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-2">
                {todayDate}
              </p>
              <h1 className="font-display text-4xl text-foreground tracking-tight">
                Schedule
              </h1>
              <p className="text-muted-foreground mt-2">
                View and manage patient appointments
              </p>
            </div>
          </div>
        </header>

        <main className="p-6">
          <Tabs defaultValue={view} onValueChange={setView} className="w-full">
            <TabsList className="bg-card border border-border rounded-xl p-1 h-auto mb-6">
              <TabsTrigger
                value="list"
                className="font-mono text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg px-4 py-2 flex items-center gap-2"
              >
                <Calendar className="h-4 w-4" />
                Appointments
              </TabsTrigger>
              <TabsTrigger
                value="types"
                className="font-mono text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg px-4 py-2 flex items-center gap-2"
              >
                <Settings className="h-4 w-4" />
                Appointment Types
              </TabsTrigger>
            </TabsList>

            <TabsContent value="list" className={cn("animate-chronicle-enter")}>
              <AppointmentList />
            </TabsContent>

            <TabsContent value="types" className={cn("animate-chronicle-enter")}>
              <AppointmentTypeManager />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </>
  );
};

export default AppointmentsPage;
