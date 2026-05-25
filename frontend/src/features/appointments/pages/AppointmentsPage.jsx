import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CircleOff from 'lucide-react/dist/esm/icons/circle-off.js';
import ListChecks from 'lucide-react/dist/esm/icons/list-checks.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import UsersRound from 'lucide-react/dist/esm/icons/users-round.js';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import AppointmentList from '@/features/appointments/components/AppointmentList';
import AppointmentTypeManager from '@/features/appointments/components/AppointmentTypeManager';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { keyWith } from '@/shared/lib/queryKeys';

const todayIso = () => new Date().toISOString().slice(0, 10);

const initialSessionForm = () => ({
  name: '',
  clinic_id: '',
  service_id: '',
  mode: 'capacity_block',
  date: todayIso(),
  start_time: '08:00',
  end_time: '12:00',
  capacity: 20,
  slot_minutes: 30,
  allow_overbooking: false,
  overbook_limit: 0,
});

const initialExceptionForm = () => ({
  session_id: '',
  date: todayIso(),
  start_time: '08:00',
  end_time: '12:00',
  reason: '',
});

const sessionTimeFormatter = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: 'short',
});

function formatDateTime(value) {
  if (!value) return 'Unscheduled';
  return sessionTimeFormatter.format(new Date(value));
}

function toUtcIso(date, time) {
  return new Date(`${date}T${time}:00`).toISOString();
}

function sessionStatus(session) {
  if (!session?.is_active) return 'cancelled';
  if ((session.remaining_capacity || 0) > 0) return 'open';
  if ((session.overbook_remaining || 0) > 0) return 'overbook';
  return 'full';
}

function statusClass(status) {
  switch (status) {
    case 'open':
      return 'badge-chronicle-emerald';
    case 'overbook':
      return 'badge-chronicle-amber';
    case 'full':
      return 'badge-chronicle-rose';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function MetricTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
        </div>
        <Icon className="size-5 text-muted-foreground" />
      </div>
    </div>
  );
}

function SessionRows({ sessions, emptyTitle }) {
  if (!sessions?.length) {
    return (
      <PageState
        variant="empty"
        title={emptyTitle}
        description="Create a session or widen the selected filters."
        fullHeight={false}
        className="min-h-0 rounded-md border border-dashed border-border bg-card/40 py-10"
      />
    );
  }

  return (
    <div className="divide-y divide-border rounded-md border border-border bg-card">
      {sessions.map((session) => {
        const status = sessionStatus(session);
        return (
          <div key={session.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{session.name}</h3>
                <Badge className={cn('font-mono text-[11px]', statusClass(status))}>
                  {status}
                </Badge>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {session.mode === 'fixed_slot' ? 'fixed slots' : 'capacity block'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDateTime(session.starts_at)} - {formatDateTime(session.ends_at)}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-right font-mono text-xs">
              <span>
                <b className="block text-base text-foreground">{session.capacity}</b>
                capacity
              </span>
              <span>
                <b className="block text-base text-foreground">{session.booked_count || 0}</b>
                booked
              </span>
              <span>
                <b className="block text-base text-foreground">{session.remaining_capacity || 0}</b>
                left
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExceptionRows({ exceptions, sessionsById }) {
  if (!exceptions?.length) {
    return (
      <PageState
        variant="empty"
        title="No exceptions for this day"
        description="Blocked time and unavailable sessions will appear here."
        fullHeight={false}
        className="min-h-0 rounded-md border border-dashed border-border bg-card/40 py-10"
      />
    );
  }

  return (
    <div className="divide-y divide-border rounded-md border border-border bg-card">
      {exceptions.map((exception) => {
        const session = sessionsById.get(exception.session_id);
        return (
          <div key={exception.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {session?.name || 'Practitioner unavailable'}
                </h3>
                <Badge className="badge-chronicle-amber font-mono text-[11px]">
                  exception
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDateTime(exception.starts_at)} - {formatDateTime(exception.ends_at)}
              </p>
            </div>
            <p className="max-w-md text-sm text-muted-foreground lg:text-right">
              {exception.reason}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function SessionForm({
  form,
  clinics,
  services,
  servicesLoading,
  createSession,
  onField,
  onSubmit,
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-md border border-border bg-card p-4">
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <Label htmlFor="session-name">Session name</Label>
          <Input
            id="session-name"
            value={form.name}
            onChange={(event) => onField('name', event.target.value)}
            placeholder="Antenatal clinic morning"
          />
        </div>
        <div>
          <Label htmlFor="session-clinic">Clinic</Label>
          <select
            id="session-clinic"
            value={form.clinic_id}
            onChange={(event) => onField('clinic_id', event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Select clinic</option>
            {clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="session-service">Service</Label>
          <select
            id="session-service"
            value={form.service_id}
            onChange={(event) => onField('service_id', event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            disabled={servicesLoading}
          >
            <option value="">Any service</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="session-date">Date</Label>
          <Input
            id="session-date"
            type="date"
            value={form.date}
            onChange={(event) => onField('date', event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="session-start">Start</Label>
          <Input
            id="session-start"
            type="time"
            value={form.start_time}
            onChange={(event) => onField('start_time', event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="session-end">End</Label>
          <Input
            id="session-end"
            type="time"
            value={form.end_time}
            onChange={(event) => onField('end_time', event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="session-capacity">Capacity</Label>
          <Input
            id="session-capacity"
            type="number"
            min="1"
            value={form.capacity}
            onChange={(event) => onField('capacity', event.target.value)}
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="submit" disabled={createSession.isPending} className="gap-2">
          <Plus className="size-4" />
          Create Session
        </Button>
      </div>
    </form>
  );
}

function WaitlistRows({ entries, isLoading, onBook }) {
  if (isLoading) {
    return (
      <PageState
        variant="loading"
        fullHeight={false}
        className="min-h-0 rounded-md border border-border"
      />
    );
  }

  if (!entries.length) {
    return (
      <PageState
        variant="empty"
        title="No active waitlist entries"
        description="Accepted demand will appear here before promotion."
        fullHeight={false}
        className="min-h-0 rounded-md border border-dashed border-border bg-card/40 py-10"
      />
    );
  }

  return (
    <div className="divide-y divide-border rounded-md border border-border bg-card">
      {entries.map((entry) => (
        <div key={entry.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {entry.patient_name || 'Unknown patient'}
              </h3>
              <Badge className="badge-chronicle-amber font-mono text-[11px]">
                {entry.priority}
              </Badge>
              <Badge variant="outline" className="font-mono text-[11px]">
                {entry.status}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {entry.service} · {entry.patient_mrn || 'No MRN'}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => onBook(entry.patient_id)}>
            Book
          </Button>
        </div>
      ))}
    </div>
  );
}

function ExceptionForm({
  form,
  sessions,
  createException,
  onField,
  onSubmit,
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-md border border-border bg-card p-4">
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Label htmlFor="exception-session">Session</Label>
          <select
            id="exception-session"
            value={form.session_id}
            onChange={(event) => onField('session_id', event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Select session</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="exception-date">Date</Label>
          <Input
            id="exception-date"
            type="date"
            value={form.date}
            onChange={(event) => onField('date', event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="exception-start">Start</Label>
          <Input
            id="exception-start"
            type="time"
            value={form.start_time}
            onChange={(event) => onField('start_time', event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="exception-end">End</Label>
          <Input
            id="exception-end"
            type="time"
            value={form.end_time}
            onChange={(event) => onField('end_time', event.target.value)}
          />
        </div>
        <div className="lg:col-span-4">
          <Label htmlFor="exception-reason">Reason</Label>
          <Input
            id="exception-reason"
            value={form.reason}
            onChange={(event) => onField('reason', event.target.value)}
            placeholder="Public holiday, room unavailable, practitioner absence"
          />
        </div>
        <div className="flex items-end justify-end">
          <Button type="submit" disabled={createException.isPending} className="w-full gap-2 lg:w-auto">
            <CircleOff className="size-4" />
            Block Time
          </Button>
        </div>
      </div>
    </form>
  );
}

const AppointmentsPage = () => {
  const navigate = useNavigate();
  const [view, setView] = useState('today');
  const [sessionForm, setSessionForm] = useState(initialSessionForm);
  const [exceptionForm, setExceptionForm] = useState(initialExceptionForm);
  const createSession = useCreateSchedulingSession();
  const createException = useCreateSchedulingException();

  const pageMeta = usePageMeta({
    title: 'Schedule | Hospital Management System',
    breadcrumbs: [{ label: 'Schedule', path: '/appointments' }],
  });

  const today = useMemo(todayIso, []);
  const todayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const { data: services = [], isLoading: servicesLoading } = useSchedulingServices({ limit: 50 });
  const { data: sessions = [], isLoading: sessionsLoading } = useSchedulingSessions({
    date: today,
    limit: 50,
  });
  const { data: exceptions = [], isLoading: exceptionsLoading } = useSchedulingExceptions({
    start_date: today,
    end_date: today,
    limit: 50,
  });
  const { data: waitlist = [], isLoading: waitlistLoading } = useClinicWaitlist({ page_size: 50 });
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
        <section className="grid gap-3 md:grid-cols-3">
          <MetricTile icon={Calendar} label="Today's sessions" value={sessions.length} />
          <MetricTile icon={UsersRound} label="Open capacity" value={remainingCapacity} />
          <MetricTile icon={ListChecks} label="Active waitlist" value={activeWaitlist.length} />
        </section>

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
              <SessionRows sessions={sessions} emptyTitle="No sessions today" />
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
              <SessionRows sessions={sessions} emptyTitle="No sessions match the selected day" />
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
              onBook={(patientId) => navigate(`/appointments/create?patient=${patientId}`)}
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
            <AppointmentTypeManager />
          </TabsContent>
        </Tabs>
      </main>
    </PageShell>
  );
};

export default AppointmentsPage;
