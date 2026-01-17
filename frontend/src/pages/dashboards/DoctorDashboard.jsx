import Clock from 'lucide-react/dist/esm/icons/clock.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import PlayCircle from 'lucide-react/dist/esm/icons/circle-play.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import Inbox from 'lucide-react/dist/esm/icons/inbox.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDoctorDashboard } from '@/hooks/useDoctorDashboard';
import { useAuth } from '@/lib/auth';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';
import { useNavigate } from 'react-router-dom';

import { useVisitActions } from '@/hooks/useVisitQueries';

export default function DoctorDashboard() {
  const { facilityCode } = useAuth();
  const { data, loading, error, refetch } = useDoctorDashboard();
  const navigate = useNavigate();
  const { callPatient, startConsultation } = useVisitActions();

  if (!facilityCode) {
    return (
      <div className="min-h-screen bg-background">
        <FacilityRequiredPanel className="max-w-4xl mx-auto" />
      </div>
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
      <div className="min-h-screen bg-background p-6 space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="font-display text-2xl text-foreground">Error Loading Dashboard</h2>
          <p className="text-muted-foreground">{error.message}</p>
          <Button onClick={() => refetch()} className="font-mono text-xs">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
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

  const totalAppointments = (data.upcoming?.length || 0) + (data.completed?.length || 0) + (data.current_patient ? 1 : 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <header className="bg-card border-b border-border px-6 py-8">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-2">
              {todayDate}
            </p>
            <h1 className="font-display text-4xl text-foreground tracking-tight">
              Today's Clinic
            </h1>
            <p className="text-muted-foreground mt-2">
              {data.user_name && `Dr. ${data.user_name}`}
              {totalAppointments > 0 && (
                <span className="ml-2">
                  · {totalAppointments} appointment{totalAppointments !== 1 ? 's' : ''} scheduled
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/referrals/sent')}
              className="font-mono text-xs"
            >
              <Send className="h-4 w-4 mr-2" />
              Sent Referrals
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/referrals/inbox')}
              className="font-mono text-xs"
            >
              <Inbox className="h-4 w-4 mr-2" />
              Referral Inbox
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="font-mono text-xs"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="p-6 space-y-6">
        {/* Current Patient - Hero Card */}
        {data.current_patient ? (
          <article className={cn(
            "relative bg-card border-2 border-primary/30 rounded-2xl p-6",
            "shadow-[0_0_40px_-12px_var(--chronicle-amber)]",
            "animate-chronicle-enter"
          )}>
            {/* Status ribbon */}
            <div className="status-ribbon status-ribbon-warning" />

            <header className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <PlayCircle className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-primary">
                    Current Patient
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {data.current_patient.time_display}
                  </p>
                </div>
              </div>
              <span className="badge-chronicle-amber">In Progress</span>
            </header>

            <div className="flex items-center justify-between">
              <div className="space-y-3">
                <h2
                  tabIndex={0}
                  role="button"
                  aria-label={`View patient ${data.current_patient.patient_name}`}
                  className="font-display text-3xl text-foreground cursor-pointer hover:text-primary transition-colors focus:outline-none focus-visible:underline"
                  onClick={() => handleViewPatient(data.current_patient.patient_id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleViewPatient(data.current_patient.patient_id); } }}
                >
                  {data.current_patient.patient_name}
                </h2>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {data.current_patient.reason && (
                    <span className="flex items-center gap-1.5">
                      <Stethoscope className="h-3.5 w-3.5" />
                      {data.current_patient.reason}
                    </span>
                  )}
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted">
                    {data.current_patient.appointment_type}
                  </span>
                </div>
              </div>
              <Button
                size="lg"
                onClick={() => handleStartConsultation(data.current_patient)}
                className="font-mono"
              >
                Begin Consultation
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </article>
        ) : (
          <article className={cn(
            "bg-card/50 border border-border rounded-2xl p-12 text-center",
            "animate-chronicle-enter"
          )}>
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-display text-xl text-foreground mb-2">No Current Patient</h3>
            <p className="text-muted-foreground text-sm">
              {data.upcoming && data.upcoming.length > 0
                ? 'Next patient arriving soon'
                : 'No appointments scheduled for today'}
            </p>
          </article>
        )}

        {/* Waiting Room - Patients ready for consultation */}
        {data.waiting_room && data.waiting_room.length > 0 && (
          <section>
            <header className="flex items-center gap-3 mb-4">
              <Users className="h-5 w-5 text-amber-400" />
              <h2 className="font-display text-2xl text-foreground">Waiting Room</h2>
              <span className="font-mono text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                {data.waiting_room.length}
              </span>
            </header>

            <div className="space-y-3">
              {data.waiting_room.map((visit, index) => (
                <WaitingPatientCard
                  key={visit.encounter_id}
                  visit={visit}
                  index={index}
                  onCall={() => callPatient.mutate(visit.encounter_id)}
                  onStart={() => startConsultation.mutate(visit.encounter_id)}
                  onViewPatient={() => handleViewPatient(visit.patient_id || visit.encounter_id)}
                  isCallingPending={callPatient.isPending}
                  isStartingPending={startConsultation.isPending}
                />
              ))}
            </div>
          </section>
        )}

        {/* Upcoming Appointments */}
        <section>
          <header className="flex items-center gap-3 mb-4">
            <Calendar className="h-5 w-5 text-muted-foreground" />
            <h2 className="font-display text-2xl text-foreground">Upcoming</h2>
            <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              {data.upcoming?.length || 0}
            </span>
          </header>

          {data.upcoming && data.upcoming.length > 0 ? (
            <div className="space-y-3">
              {data.upcoming.map((appointment, index) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  index={index}
                  onStart={() => handleStartConsultation(appointment)}
                  onViewPatient={() => handleViewPatient(appointment.patient_id)}
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

        {/* Completed Today */}
        {data.completed && data.completed.length > 0 && (
          <section>
            <header className="flex items-center gap-3 mb-4">
              <CheckCircle className="h-5 w-5 text-[oklch(0.70_0.17_155)]" />
              <h2 className="font-display text-2xl text-foreground">Completed</h2>
              <span className="font-mono text-xs text-[oklch(0.70_0.17_155)] bg-[oklch(0.70_0.17_155_/_0.1)] px-2 py-0.5 rounded-full">
                {data.completed.length}
              </span>
            </header>

            <div className="space-y-2">
              {data.completed.map((appointment, index) => (
                <CompletedCard
                  key={appointment.id}
                  appointment={appointment}
                  index={index}
                  onViewPatient={() => handleViewPatient(appointment.patient_id)}
                />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
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
            <h3
              tabIndex={0}
              role="button"
              aria-label={`View patient ${appointment.patient_name}`}
              className="font-display text-xl text-foreground cursor-pointer hover:text-primary transition-colors focus:outline-none focus-visible:underline"
              onClick={onViewPatient}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onViewPatient(); } }}
            >
              {appointment.patient_name}
            </h3>
            <span className={badge.class}>{badge.label}</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5 font-mono text-xs">
              <Clock className="h-3 w-3" />
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
        <Button
          variant="outline"
          size="sm"
          onClick={onStart}
          className="font-mono text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        >
          Start
          <ChevronRight className="h-3 w-3 ml-1" />
        </Button>
      </div>
    </article>
  );
}

/**
 * CompletedCard - Completed appointment card (muted)
 */
function CompletedCard({ appointment, index, onViewPatient }) {
  return (
    <article
      className={cn(
        "bg-card/30 border border-border rounded-xl p-4 opacity-60",
        "hover:opacity-80 transition-opacity cursor-pointer",
        "animate-chronicle-enter"
      )}
      style={{ animationDelay: `${(index + 5) * 50}ms` }}
      onClick={onViewPatient}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckCircle className="h-4 w-4 text-[oklch(0.70_0.17_155)]" />
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
    </article>
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
            <h3
              tabIndex={0}
              role="button"
              aria-label={`View patient ${visit.patient_name}`}
              className="font-display text-xl text-foreground cursor-pointer hover:text-primary transition-colors focus:outline-none focus-visible:underline"
              onClick={onViewPatient}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onViewPatient(); } }}
            >
              {visit.patient_name}
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
              <Clock className="h-3 w-3" />
              Checked in {visit.checked_in_at ? new Date(visit.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
            {isCalled && visit.called_at && (
              <span className="flex items-center gap-1.5 font-mono text-xs text-amber-400">
                <Phone className="h-3 w-3" />
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
              <Phone className="h-3 w-3 mr-1" />
              Call
            </Button>
          )}
          {isCalled && (
            <Button
              size="sm"
              onClick={onStart}
              disabled={isStartingPending}
              className="font-mono text-xs"
            >
              Start Consultation
              <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
