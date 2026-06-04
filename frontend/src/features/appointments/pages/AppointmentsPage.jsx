import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CircleOff from 'lucide-react/dist/esm/icons/circle-off.js';
import ListChecks from 'lucide-react/dist/esm/icons/list-checks.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import UsersRound from 'lucide-react/dist/esm/icons/users-round.js';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import AppointmentList from '@/features/appointments/components/AppointmentList';
import BookableServicesPanel from '@/features/appointments/components/BookableServicesPanel';
import SchedulingTemplatesPanel from '@/features/appointments/components/SchedulingTemplatesPanel';
import {
  useCreateSchedulingException,
  useCreateSchedulingSession,
  useSchedulingExceptions,
  useSchedulingServices,
  useSchedulingSessions,
} from '@/features/appointments/hooks';
import { clinicsApi } from '@/features/clinics/api';
import { useClinicWaitlist } from '@/features/referrals/hooks';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { keyWith } from '@/shared/lib/queryKeys';
import { AppointmentMetrics } from './appointments/AppointmentMetrics';
import {
  ExceptionForm,
  ExceptionRows,
  SessionForm,
  SessionRows,
  WaitlistRows,
} from './appointments/AppointmentScheduleSections';
import {
  initialExceptionForm,
  initialSessionForm,
  todayIso,
  toUtcIso,
} from './appointments/appointmentsPageUtils';

const APPOINTMENT_TAB_VALUES = new Set([
  'today',
  'appointments',
  'sessions',
  'templates',
  'waitlist',
  'exceptions',
  'services',
]);

function appointmentTabFromSearchParams(searchParams) {
  const tab = searchParams.get('tab');
  if (APPOINTMENT_TAB_VALUES.has(tab)) {
    return tab;
  }
  if (searchParams.get('waitlist')) {
    return 'waitlist';
  }
  if (searchParams.get('clinic')) {
    return 'sessions';
  }
  return null;
}

const AppointmentsPage = () => {
  const navigate = useNavigate();
  const { search: routeSearch } = useLocation();
  const routeSearchParams = useMemo(() => new URLSearchParams(routeSearch), [routeSearch]);
  const targetClinicId = routeSearchParams.get('clinic') || '';
  const targetWaitlistId = routeSearchParams.get('waitlist') || '';
  const routeTab = appointmentTabFromSearchParams(routeSearchParams);
  const [view, setView] = useState(() => routeTab || 'today');
  const [sessionForm, setSessionForm] = useState(() => ({
    ...initialSessionForm(),
    ...(targetClinicId ? { clinic_id: targetClinicId } : {}),
  }));
  const [exceptionForm, setExceptionForm] = useState(initialExceptionForm);
  const createSession = useCreateSchedulingSession();
  const createException = useCreateSchedulingException();

  const pageMeta = usePageMeta({
    title: 'Schedule | Hospital Management System',
    breadcrumbs: [{ label: 'Schedule', path: '/appointments' }],
  });

  const today = useMemo(() => todayIso(), []);
  const todayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const { data: services = [], isLoading: servicesLoading } = useSchedulingServices({ limit: 50 });
  const { data: sessions = [], isLoading: sessionsLoading } = useSchedulingSessions({
    date: today,
    limit: 50,
    ...(targetClinicId ? { clinic_id: targetClinicId } : {}),
  });
  const { data: exceptions = [], isLoading: exceptionsLoading } = useSchedulingExceptions({
    start_date: today,
    end_date: today,
    limit: 50,
  });
  const { data: waitlist = [], isLoading: waitlistLoading } = useClinicWaitlist({
    page_size: targetWaitlistId ? 100 : 50,
  });
  const { data: clinics = [] } = useQuery({
    queryKey: keyWith('clinics', 'scheduling-options'),
    queryFn: ({ signal }) => clinicsApi.list({ is_active: true, page_size: 100 }, { signal }),
    staleTime: 60 * 1000,
  });

  const activeWaitlist = useMemo(
    () => waitlist.filter((entry) => ['waiting', 'offered'].includes(entry.status)),
    [waitlist],
  );
  const remainingCapacity = useMemo(
    () => sessions.reduce((total, session) => total + Math.max(0, session.remaining_capacity || 0), 0),
    [sessions],
  );
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );

  useEffect(() => {
    if (routeTab) {
      setView(routeTab);
    }
  }, [routeTab]);

  useEffect(() => {
    if (!targetClinicId) {
      return;
    }
    setSessionForm((current) => {
      if (current.clinic_id === targetClinicId) {
        return current;
      }
      return { ...current, clinic_id: targetClinicId };
    });
  }, [targetClinicId]);

  const handleSessionField = (field, value) => {
    setSessionForm((current) => ({ ...current, [field]: value }));
  };

  const handleExceptionField = (field, value) => {
    setExceptionForm((current) => ({ ...current, [field]: value }));
  };

  const handleCreateSession = async (event) => {
    event.preventDefault();
    if (!sessionForm.name.trim()) {
      toast.error('Session name is required');
      return;
    }
    if (!sessionForm.clinic_id) {
      toast.error('Clinic is required');
      return;
    }

    try {
      await createSession.mutateAsync({
        ...sessionForm,
        starts_at: toUtcIso(sessionForm.date, sessionForm.start_time),
        ends_at: toUtcIso(sessionForm.date, sessionForm.end_time),
      });
      toast.success('Session created');
      setSessionForm(initialSessionForm());
      setView('today');
    } catch (error) {
      toast.error('Session was not created', {
        description: error.message || 'Please check the session details.',
      });
    }
  };

  const handleCreateException = async (event) => {
    event.preventDefault();
    if (!exceptionForm.session_id) {
      toast.error('Session is required');
      return;
    }
    if (!exceptionForm.reason.trim()) {
      toast.error('Exception reason is required');
      return;
    }

    try {
      await createException.mutateAsync({
        session_id: exceptionForm.session_id,
        starts_at: toUtcIso(exceptionForm.date, exceptionForm.start_time),
        ends_at: toUtcIso(exceptionForm.date, exceptionForm.end_time),
        reason: exceptionForm.reason,
      });
      toast.success('Exception created');
      setExceptionForm(initialExceptionForm());
    } catch (error) {
      toast.error('Exception was not created', {
        description: error.message || 'Please check the blocked time.',
      });
    }
  };

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="Schedule"
        description="Appointments, sessions, arrivals, and waitlist demand"
        meta={todayDate}
        size="lg"
        actions={(
          <Button onClick={() => navigate('/appointments/create')} className="gap-2">
            <Plus className="size-4" />
            Book Patient
          </Button>
        )}
      />

      <main className="space-y-6 p-6">
        <AppointmentMetrics
          activeWaitlistCount={activeWaitlist.length}
          remainingCapacity={remainingCapacity}
          sessionCount={sessions.length}
          sessionsIcon={Calendar}
          capacityIcon={UsersRound}
          waitlistIcon={ListChecks}
        />

        <Tabs value={view} onValueChange={setView} className="w-full">
          <TabsList className="h-auto rounded-md border border-border bg-card p-1">
            <TabsTrigger value="today" className="gap-2 rounded-sm px-4 py-2 font-mono text-xs">
              <Clock className="size-4" />
              Today
            </TabsTrigger>
            <TabsTrigger value="appointments" className="gap-2 rounded-sm px-4 py-2 font-mono text-xs">
              <Calendar className="size-4" />
              Appointments
            </TabsTrigger>
            <TabsTrigger value="sessions" className="gap-2 rounded-sm px-4 py-2 font-mono text-xs">
              <Plus className="size-4" />
              Sessions
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-2 rounded-sm px-4 py-2 font-mono text-xs">
              <RefreshCw className="size-4" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="waitlist" className="gap-2 rounded-sm px-4 py-2 font-mono text-xs">
              <ListChecks className="size-4" />
              Waitlist
            </TabsTrigger>
            <TabsTrigger value="exceptions" className="gap-2 rounded-sm px-4 py-2 font-mono text-xs">
              <CircleOff className="size-4" />
              Exceptions
            </TabsTrigger>
            <TabsTrigger value="services" className="gap-2 rounded-sm px-4 py-2 font-mono text-xs">
              <Settings className="size-4" />
              Services
            </TabsTrigger>
          </TabsList>

          <TabsContent value="today" className="animate-chronicle-enter space-y-6 pt-6">
            {sessionsLoading ? (
              <PageState variant="loading" fullHeight={false} className="min-h-0 rounded-md border border-border" />
            ) : (
              <SessionRows
                sessions={sessions}
                emptyTitle="No sessions today"
                targetClinicId={targetClinicId}
              />
            )}
          </TabsContent>

          <TabsContent value="appointments" className="animate-chronicle-enter pt-6">
            <AppointmentList />
          </TabsContent>

          <TabsContent value="sessions" className="animate-chronicle-enter space-y-6 pt-6">
            <SessionForm
              form={sessionForm}
              clinics={clinics}
              services={services}
              servicesLoading={servicesLoading}
              createSession={createSession}
              onField={handleSessionField}
              onSubmit={handleCreateSession}
            />

            {sessionsLoading ? (
              <PageState variant="loading" fullHeight={false} className="min-h-0 rounded-md border border-border" />
            ) : (
              <SessionRows
                sessions={sessions}
                emptyTitle="No sessions match the selected day"
                targetClinicId={targetClinicId}
              />
            )}
          </TabsContent>

          <TabsContent value="templates" className="animate-chronicle-enter space-y-6 pt-6">
            <SchedulingTemplatesPanel
              clinics={clinics}
              services={services}
              servicesLoading={servicesLoading}
            />
          </TabsContent>

          <TabsContent value="waitlist" className="animate-chronicle-enter pt-6">
            <WaitlistRows
              entries={activeWaitlist}
              isLoading={waitlistLoading}
              targetEntryId={targetWaitlistId}
              onPromote={(entry) => {
                const params = new URLSearchParams({
                  patient: entry.patient_id,
                  waitlist: entry.id,
                });
                if (entry.service) {
                  params.set('comment', `Waitlist service: ${entry.service}`);
                }
                navigate(`/appointments/create?${params.toString()}`);
              }}
            />
          </TabsContent>

          <TabsContent value="exceptions" className="animate-chronicle-enter space-y-6 pt-6">
            <ExceptionForm
              form={exceptionForm}
              sessions={sessions}
              createException={createException}
              onField={handleExceptionField}
              onSubmit={handleCreateException}
            />

            {exceptionsLoading ? (
              <PageState variant="loading" fullHeight={false} className="min-h-0 rounded-md border border-border" />
            ) : (
              <ExceptionRows exceptions={exceptions} sessionsById={sessionsById} />
            )}
          </TabsContent>

          <TabsContent value="services" className="animate-chronicle-enter pt-6">
            <BookableServicesPanel services={services} isLoading={servicesLoading} />
          </TabsContent>
        </Tabs>
      </main>
    </PageShell>
  );
};

export default AppointmentsPage;
