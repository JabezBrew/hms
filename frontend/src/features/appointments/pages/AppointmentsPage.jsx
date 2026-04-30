import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import AppointmentList from '@/features/appointments/components/AppointmentList';
import AppointmentTypeManager from '@/features/appointments/components/AppointmentTypeManager';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

const AppointmentsPage = () => {
  const [view, setView] = useState('list');
  const pageMeta = usePageMeta({
    title: 'Schedule | Hospital Management System',
    breadcrumbs: [{ label: 'Schedule', path: '/appointments' }],
  });
  const todayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="Schedule"
        description="View and manage patient appointments"
        meta={todayDate}
        size="lg"
      />

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
    </PageShell>
  );
};

export default AppointmentsPage;
