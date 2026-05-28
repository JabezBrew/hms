import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import PlayCircle from 'lucide-react/dist/esm/icons/circle-play.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import Inbox from 'lucide-react/dist/esm/icons/inbox.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDashboardModuleGates,
  useDoctorDashboard,
  useDoctorDashboardLiveUpdates,
} from '@/features/dashboards/hooks';
import { useAuth } from '@/lib/auth';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';
import { useNavigate } from 'react-router-dom';

import { useVisitActions } from '@/hooks/useVisitQueries';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';

export default function DoctorDashboard() {
  const { facilityCode } = useAuth();
  const moduleGate = useDashboardModuleGates({ enabled: Boolean(facilityCode) });
  const dashboardEnabled = Boolean(facilityCode) && moduleGate.outpatientEncountersEnabled;
  const { isConnected: isLiveConnected } = useDoctorDashboardLiveUpdates({
    enabled: dashboardEnabled,
    stream: 'my-work',
  });
  const { data, loading, error, refetch, isFetching } = useDoctorDashboard({
    refetchInterval: isLiveConnected ? false : 30000,
    enabled: dashboardEnabled,
  });
  const navigate = useNavigate();
  const { callPatient, startConsultation } = useVisitActions();
  const canUseAppointments = moduleGate.appointmentsEnabled;
  const canUsePatientChronicle = moduleGate.patientChronicleEnabled;
  const canUseReferrals = moduleGate.referralsEnabled;
  const canStartConsultation = moduleGate.outpatientEncountersEnabled && canUsePatientChronicle;

  if (!facilityCode) {
    return (
      <PageShell>
        <PageHeader
          title="Today's Clinic"
          description="Clinic overview"
        />
        <div className="p-6">
          <FacilityRequiredPanel className="max-w-4xl mx-auto" />
        </div>
      </PageShell>
    );
  }

  if (moduleGate.isResolving) {
    return (
      <PageShell>
        <PageHeader
          title="Today's Clinic"
          description="Clinic overview"
        />
        <PageState variant="loading" fullHeight={false} />
      </PageShell>
    );
  }

  if (!moduleGate.hasFeatureMap) {
    return (
      <PageShell>
        <PageHeader
          title="Today's Clinic"
          description="Clinic overview"
        />
        <PageState
          variant="error"
          title="Feature capabilities unavailable"
          description={moduleGate.error?.message || 'Module entitlements could not be loaded.'}
          action={() => moduleGate.refetch()}
          fullHeight={false}
        />
      </PageShell>
    );
  }

  if (!moduleGate.outpatientEncountersEnabled) {
    return (
      <PageShell>
        <PageHeader
          title="Today's Clinic"
          description="Clinic overview"
        />
        <PageState
          variant="empty"
          title="Clinic dashboard disabled"
          description="Outpatient encounters are not enabled for this deployment."
          fullHeight={false}
        />
      </PageShell>
    );
  }

  const handleStartConsultation = (patient) => {
    const patientId = patient.patient_id || patient.id;
    if (patientId) {
      navigate(`/patients/${patientId}?consultation=true`);
    }
  };

  const handleViewPatient = (patientId) => {
    if (patientId) {
      navigate(`/patients/${patientId}`);
    }
  };

  // Loading state
  if (loading) {
    return (
      <PageShell>
        <div className="p-6 space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-12 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </PageShell>
    );
  }

  // Error state
  if (error) {
    return (
      <PageShell>
        <PageState
          variant="error"
          title="Error Loading Dashboard"
          description={error.message}
          action={() => refetch()}
        />
      </PageShell>
    );
  }

  const todayDate = data.date
    ? new Date(data.date).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      })
    : new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      });

  const totalAppointments = canUseAppointments
    ? (data.upcoming?.length || 0) + (data.completed?.length || 0) + (data.current_patient ? 1 : 0)
    : 0;

  return (
    <PageShell>
      <PageHeader
        meta={todayDate}
        title="Today's Clinic"
        description={(
          <span>
            {data.user_name && `Dr. ${data.user_name}`}
            {totalAppointments > 0 && (
              <span className="ml-2">
                · {totalAppointments} appointment{totalAppointments !== 1 ? 's' : ''} scheduled
              </span>
            )}
          </span>
        )}
        actions={(
          <DoctorDashboardActions
            canUseReferrals={canUseReferrals}
            isFetching={isFetching}
            onOpenSentReferrals={() => navigate('/referrals/sent')}
            onOpenReferralInbox={() => navigate('/referrals/inbox')}
            onRefresh={() => refetch()}
          />
        )}
        descriptionClassName="text-muted-foreground mt-2"
      />

      <main className="p-6 space-y-6">
        <CurrentPatientPanel
          currentPatient={data.current_patient}
          upcomingCount={data.upcoming?.length || 0}
          canUseAppointments={canUseAppointments}
          canUsePatientChronicle={canUsePatientChronicle}
          canStartConsultation={canStartConsultation}
          onViewPatient={handleViewPatient}
          onStartConsultation={handleStartConsultation}
        />
        <WaitingRoomSection
          visits={data.waiting_room || []}
          canStartConsultation={canStartConsultation}
          canUsePatientChronicle={canUsePatientChronicle}
          callPatient={callPatient}
          startConsultation={startConsultation}
          onViewPatient={handleViewPatient}
        />
        <UpcomingAppointmentsSection
          appointments={data.upcoming || []}
          canUseAppointments={canUseAppointments}
          canStartConsultation={canStartConsultation}
          canUsePatientChronicle={canUsePatientChronicle}
          onStartConsultation={handleStartConsultation}
          onViewPatient={handleViewPatient}
        />
        <CompletedAppointmentsSection
          appointments={data.completed || []}
          canUseAppointments={canUseAppointments}
          canUsePatientChronicle={canUsePatientChronicle}
          onViewPatient={handleViewPatient}
        />
      </main>
    </PageShell>
  );
}

function DoctorDashboardActions({
  canUseReferrals,
  isFetching,
  onOpenSentReferrals,
  onOpenReferralInbox,
  onRefresh,
}) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      {canUseReferrals ? (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenSentReferrals}
            className="font-mono text-xs"
          >
            <Send className="size-4 mr-2" />
            Sent Referrals
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenReferralInbox}
            className="font-mono text-xs"
          >
            <Inbox className="size-4 mr-2" />
            Referral Inbox
          </Button>
        </>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        className="font-mono text-xs"
        disabled={isFetching}
      >
        {isFetching ? (
          <LoadingSpinner className="mr-2 h-4 w-8" />
        ) : (
          <RefreshCw className="size-4 mr-2" />
        )}
        Refresh
      </Button>
    </div>
  );
}

function CurrentPatientPanel({
  currentPatient,
  upcomingCount,
  canUseAppointments,
  canUsePatientChronicle,
  canStartConsultation,
  onViewPatient,
  onStartConsultation,
}) {
  if (!currentPatient) {
    return (
      <article className={cn(
        "bg-card/50 border border-border rounded-2xl p-12 text-center",
        "animate-chronicle-enter"
      )}>
        <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
          <Clock className="size-8 text-muted-foreground" />
        </div>
        <h3 className="font-display text-xl text-foreground mb-2">No Current Patient</h3>
        <p className="text-muted-foreground text-sm">
          {canUseAppointments && upcomingCount > 0
            ? 'Next patient arriving soon'
            : canUseAppointments
            ? 'No appointments scheduled for today'
            : 'No active clinic patient'}
        </p>
      </article>
    );
  }

  return (
    <article className={cn(
      "relative bg-card border-2 border-primary/30 rounded-2xl p-6",
      "shadow-[0_0_40px_-12px_var(--chronicle-amber)]",
      "animate-chronicle-enter"
    )}>
      <div className="status-ribbon status-ribbon-warning" />
      <header className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
            <PlayCircle className="size-5 text-primary" />
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-primary">
              Current Patient
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {currentPatient.time_display}
            </p>
          </div>
        </div>
        <span className="badge-chronicle-amber">In Progress</span>
      </header>

      <div className="flex items-center justify-between">
        <div className="space-y-3">
          <h2 className="font-display text-3xl text-foreground">
            {canUsePatientChronicle ? (
              <button
                type="button"
                aria-label={`View patient ${currentPatient.patient_name}`}
                className="cursor-pointer bg-transparent p-0 text-left [font:inherit] hover:text-primary focus:outline-none focus-visible:underline"
                onClick={() => onViewPatient(currentPatient.patient_id)}
              >
                {currentPatient.patient_name}
              </button>
            ) : (
              currentPatient.patient_name
            )}
          </h2>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {currentPatient.reason && (
              <span className="flex items-center gap-1.5">
                <Stethoscope className="size-3.5" />
                {currentPatient.reason}
              </span>
            )}
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted">
              {currentPatient.appointment_type}
            </span>
          </div>
        </div>
        {canStartConsultation ? (
          <Button
            size="lg"
            onClick={() => onStartConsultation(currentPatient)}
            className="font-mono"
          >
            Begin Consultation
            <ChevronRight className="size-4 ml-2" />
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function WaitingRoomSection({
  visits,
  canStartConsultation,
  canUsePatientChronicle,
  callPatient,
  startConsultation,
  onViewPatient,
}) {
  if (visits.length === 0) {
    return null;
  }

  return (
    <section>
      <header className="flex items-center gap-3 mb-4">
        <Users className="size-5 text-amber-400" />
        <h2 className="font-display text-2xl text-foreground">Waiting Room</h2>
        <span className="font-mono text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
          {visits.length}
        </span>
      </header>

      <div className="space-y-3">
        {visits.map((visit, index) => (
          <WaitingPatientCard
            key={visit.encounter_id}
            visit={visit}
            index={index}
            onCall={() => callPatient.mutate(visit.encounter_id)}
            onStart={canStartConsultation ? () => startConsultation.mutate(visit.encounter_id) : undefined}
            onViewPatient={
              canUsePatientChronicle
                ? () => onViewPatient(visit.patient_id || visit.encounter_id)
                : undefined
            }
            isCallingPending={callPatient.isPending}
            isStartingPending={startConsultation.isPending}
          />
        ))}
      </div>
    </section>
  );
}

function UpcomingAppointmentsSection({
  appointments,
  canUseAppointments,
  canStartConsultation,
  canUsePatientChronicle,
  onStartConsultation,
  onViewPatient,
}) {
  if (!canUseAppointments) {
    return null;
  }

  return (
    <section>
      <header className="flex items-center gap-3 mb-4">
        <Calendar className="size-5 text-muted-foreground" />
        <h2 className="font-display text-2xl text-foreground">Upcoming</h2>
        <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">
          {appointments.length}
        </span>
      </header>

      {appointments.length > 0 ? (
        <div className="space-y-3">
          {appointments.map((appointment, index) => (
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              index={index}
              onStart={canStartConsultation ? () => onStartConsultation(appointment) : undefined}
              onViewPatient={canUsePatientChronicle ? () => onViewPatient(appointment.patient_id) : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="bg-card/30 border border-border rounded-xl p-8 text-center">
          <p className="text-muted-foreground text-sm font-mono">
            No upcoming appointments
          </p>
        </div>
      )}
    </section>
  );
}

function CompletedAppointmentsSection({
  appointments,
  canUseAppointments,
  canUsePatientChronicle,
  onViewPatient,
}) {
  if (!canUseAppointments || appointments.length === 0) {
    return null;
  }

  return (
    <section>
      <header className="flex items-center gap-3 mb-4">
        <CheckCircle className="size-5 text-[oklch(0.70_0.17_155)]" />
        <h2 className="font-display text-2xl text-foreground">Completed</h2>
        <span className="font-mono text-xs text-[oklch(0.70_0.17_155)] bg-[oklch(0.70_0.17_155_/_0.1)] px-2 py-0.5 rounded-full">
          {appointments.length}
        </span>
      </header>

      <div className="space-y-2">
        {appointments.map((appointment, index) => (
          <CompletedCard
            key={appointment.id}
            appointment={appointment}
            index={index}
            onViewPatient={canUsePatientChronicle ? () => onViewPatient(appointment.patient_id) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * AppointmentCard - Upcoming appointment card
 */
function AppointmentCard({ appointment, index, onStart, onViewPatient }) {
  const getStatusBadge = (status) => {
    const statusMap = {
      'arrived': { class: 'badge-chronicle-emerald', label: 'Arrived' },
      'booked': { class: 'badge-chronicle-sky', label: 'Booked' },
      'in-progress': { class: 'badge-chronicle-amber', label: 'In Progress' },
      'cancelled': { class: 'badge-chronicle-rose', label: 'Cancelled' },
    };
    return statusMap[status] || { class: 'badge-chronicle-sky', label: status };
  };

  const badge = getStatusBadge(appointment.status);

  return (
    <article
      className={cn(
        "group relative bg-card/50 border border-border rounded-xl p-5",
        "hover:border-primary/30 hover:shadow-[0_0_20px_-8px_var(--chronicle-amber)]",
        "transition-all duration-300",
        "animate-chronicle-enter"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-xl text-foreground">
              {onViewPatient ? (
                <button
                  type="button"
                  aria-label={`View patient ${appointment.patient_name}`}
                  className="cursor-pointer bg-transparent p-0 text-left [font:inherit] hover:text-primary focus:outline-none focus-visible:underline"
                  onClick={onViewPatient}
                >
                  {appointment.patient_name}
                </button>
              ) : (
                appointment.patient_name
              )}
            </h3>
            <span className={badge.class}>{badge.label}</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5 font-mono text-xs">
              <Clock className="size-3" />
              {appointment.time_display}
            </span>
            {appointment.reason && (
              <span>{appointment.reason}</span>
            )}
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted">
              {appointment.appointment_type}
            </span>
          </div>
        </div>
        {onStart ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onStart}
            className="font-mono text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Start
            <ChevronRight className="size-3 ml-1" />
          </Button>
        ) : null}
      </div>
    </article>
  );
}

/**
 * CompletedCard - Completed appointment card (muted)
 */
function CompletedCard({ appointment, index, onViewPatient }) {
  const CardElement = onViewPatient ? 'button' : 'div';
  const interactiveProps = onViewPatient
    ? {
        type: 'button',
        onClick: onViewPatient,
        'aria-label': `View patient ${appointment.patient_name}`,
      }
    : {};

  return (
    <CardElement
      className={cn(
        "bg-card/30 border border-border rounded-xl p-4 opacity-60 text-left",
        onViewPatient && "w-full",
        onViewPatient && "hover:opacity-80 transition-opacity cursor-pointer",
        "animate-chronicle-enter"
      )}
      style={{ animationDelay: `${(index + 5) * 50}ms` }}
      {...interactiveProps}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckCircle className="size-4 text-[oklch(0.70_0.17_155)]" />
          <div>
            <h3 className="font-medium text-foreground">
              {appointment.patient_name}
            </h3>
            <p className="font-mono text-xs text-muted-foreground">
              {appointment.time_display} · {appointment.appointment_type}
            </p>
          </div>
        </div>
        <span className="badge-chronicle-emerald">Completed</span>
      </div>
    </CardElement>
  );
}

/**
 * WaitingPatientCard - Patient waiting in queue for consultation
 */
function WaitingPatientCard({ visit, index, onCall, onStart, onViewPatient, isCallingPending, isStartingPending }) {
  const isWaiting = visit.visit_status === 'waiting';
  const isCalled = visit.visit_status === 'called';

  return (
    <article
      className={cn(
        "group relative bg-card border rounded-xl p-5",
        isCalled
          ? "border-amber-500/50 shadow-[0_0_20px_-8px_var(--chronicle-amber)]"
          : "border-border hover:border-primary/30",
        "transition-all duration-300",
        "animate-chronicle-enter"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-muted-foreground">
              #{visit.queue_number}
            </span>
            <h3 className="font-display text-xl text-foreground">
              {onViewPatient ? (
                <button
                  type="button"
                  aria-label={`View patient ${visit.patient_name}`}
                  className="cursor-pointer bg-transparent p-0 text-left [font:inherit] hover:text-primary focus:outline-none focus-visible:underline"
                  onClick={onViewPatient}
                >
                  {visit.patient_name}
                </button>
              ) : (
                visit.patient_name
              )}
            </h3>
            <span className={cn(
              "text-xs font-mono px-2 py-0.5 rounded",
              isCalled
                ? "bg-amber-500/10 text-amber-400 animate-pulse"
                : "bg-sky-500/10 text-sky-400"
            )}>
              {isCalled ? 'Called' : 'Waiting'}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5 font-mono text-xs">
              <Clock className="size-3" />
              Checked in {visit.checked_in_at ? new Date(visit.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
            {isCalled && visit.called_at && (
              <span className="flex items-center gap-1.5 font-mono text-xs text-amber-400">
                <Phone className="size-3" />
                Called {new Date(visit.called_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isWaiting && (
            <Button
              variant="outline"
              size="sm"
              onClick={onCall}
              disabled={isCallingPending}
              className="font-mono text-xs"
            >
              <Phone className="size-3 mr-1" />
              Call
            </Button>
          )}
          {isCalled && onStart && (
            <Button
              size="sm"
              onClick={onStart}
              disabled={isStartingPending}
              className="font-mono text-xs"
            >
              Start Consultation
              <ChevronRight className="size-3 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
