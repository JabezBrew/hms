import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import Mail from 'lucide-react/dist/esm/icons/mail.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/layout';
import {
  StatCard,
  ActionCard,
  DashboardSection,
  DashboardGrid,
} from '@/components/dashboard';
import {
  useDashboardModuleGates,
  useDashboardActions,
  useReceptionDashboardLiveUpdates,
  useReceptionistDashboard,
} from '@/features/dashboards/hooks';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import format from 'date-fns/format';
import { useAuth } from '@/lib/auth';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';

export default function ReceptionistDashboard() {
  const navigate = useNavigate();
  const { facilityCode } = useAuth();
  const moduleGate = useDashboardModuleGates({ enabled: Boolean(facilityCode) });
  const hasReceptionModules = moduleGate.appointmentsEnabled
    || moduleGate.billingEnabled
    || moduleGate.emergencyEncountersEnabled
    || moduleGate.patientRegistrationEnabled;
  const dashboardEnabled = Boolean(facilityCode) && moduleGate.hasFeatureMap && hasReceptionModules;
  const { isConnected: isLiveConnected } = useReceptionDashboardLiveUpdates({
    enabled: dashboardEnabled,
  });

  // Fetch dashboard data with websocket-triggered refresh, polling fallback.
  const {
    data: dashboardData,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useReceptionistDashboard({
    refetchInterval: isLiveConnected ? false : 30000,
    enabled: dashboardEnabled,
  });

  // Action handlers
  const { checkInPatient } = useDashboardActions();
  const generatedAt = dashboardData?.meta?.generated_at;
  const nowMs = useMemo(() => getDashboardNowMs(generatedAt), [generatedAt]);

  if (!facilityCode) {
    return (
      <Layout>
        <PageShell>
          <PageHeader
            title="Reception Dashboard"
            description="Manage check-ins, scheduling, and front desk operations"
          />
          <div className="p-4 sm:p-6">
            <FacilityRequiredPanel />
          </div>
        </PageShell>
      </Layout>
    );
  }

  if (moduleGate.isResolving) {
    return (
      <Layout>
        <PageShell>
          <PageHeader
            title="Reception Dashboard"
            description="Manage check-ins, scheduling, and front desk operations"
          />
          <PageState variant="loading" fullHeight={false} />
        </PageShell>
      </Layout>
    );
  }

  if (!moduleGate.hasFeatureMap) {
    return (
      <Layout>
        <PageShell>
          <PageHeader
            title="Reception Dashboard"
            description="Manage check-ins, scheduling, and front desk operations"
          />
          <PageState
            variant="error"
            title="Feature capabilities unavailable"
            description={moduleGate.error?.message || 'Module entitlements could not be loaded.'}
            action={() => moduleGate.refetch()}
            fullHeight={false}
            className="min-h-0"
          />
        </PageShell>
      </Layout>
    );
  }

  if (!hasReceptionModules) {
    return (
      <Layout>
        <PageShell>
          <PageHeader
            title="Reception Dashboard"
            description="Manage check-ins, scheduling, and front desk operations"
          />
          <PageState
            variant="empty"
            title="Reception modules disabled"
            description="Patient registration, appointments, triage, and billing are not enabled for this deployment."
            fullHeight={false}
            className="min-h-0"
          />
        </PageShell>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <PageShell>
          <PageHeader
            title="Reception Dashboard"
            description="Manage check-ins, scheduling, and front desk operations"
          />
          <PageState
            variant="error"
            title="Failed to load dashboard"
            description={error.message}
            action={() => refetch()}
            fullHeight={false}
            className="min-h-0"
          />
        </PageShell>
      </Layout>
    );
  }

  const checkInQueue = dashboardData?.check_in_queue || [];
  const recentRegistrations = dashboardData?.recent_registrations || [];
  const todaysAppointments = dashboardData?.todays_appointments || [];
  const stats = dashboardData?.stats || {};

  return (
    <Layout>
      <PageShell>
        <PageHeader
          title="Reception Dashboard"
          description="Manage patient check-ins, registrations, and appointments"
          actions={(
            <div className="flex items-center gap-2">
              {moduleGate.patientRegistrationEnabled ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => navigate('/patients/create')}
                >
                  <UserPlus className="size-4 mr-2" />
                  Register Patient
                </Button>
              ) : null}
              {moduleGate.emergencyEncountersEnabled ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/triage')}
                >
                  <ClipboardList className="size-4 mr-2" />
                  Triage Queue
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetch()}
                disabled={isFetching}
                aria-label="Refresh dashboard"
              >
                <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
              </Button>
            </div>
          )}
        />

        <div className="p-4 sm:p-6 space-y-6 sm:space-y-8">
	        <ReceptionStats
	          isLoading={isLoading}
	          moduleGate={moduleGate}
	          checkInCount={checkInQueue.length}
	          recentRegistrationCount={recentRegistrations.length}
	          stats={stats}
	        />

	        {/* Check-In Queue */}
	        {moduleGate.appointmentsEnabled ? (
	          <CheckInQueueSection
	            isLoading={isLoading}
	            appointments={checkInQueue}
	            nowMs={nowMs}
	            checkInPatient={checkInPatient}
	            onViewAppointment={(appointmentId) => navigate(`/appointments/${appointmentId}`)}
	          />
	        ) : null}

	        {/* Today's Appointments */}
	        {moduleGate.appointmentsEnabled ? (
	          <TodaysAppointmentsSection
	            isLoading={isLoading}
	            appointments={todaysAppointments}
	            onViewAll={() => navigate('/appointments')}
	            onViewAppointment={(appointmentId) => navigate(`/appointments/${appointmentId}`)}
	          />
	        ) : null}

	        {/* Recent Registrations */}
	        {moduleGate.patientRegistrationEnabled ? (
	          <RecentRegistrationsSection
	            isLoading={isLoading}
	            patients={recentRegistrations}
	            moduleGate={moduleGate}
	            onScheduleAppointment={(patientId) => navigate(`/appointments/create?patient=${patientId}`)}
	            onViewPatient={(patientId) => navigate(`/patients/${patientId}`)}
	          />
	        ) : null}
        </div>
      </PageShell>
    </Layout>
  );
}

function getDashboardNowMs(_generatedAt) {
  return Date.now();
}

function ReceptionStats({ isLoading, moduleGate, checkInCount, recentRegistrationCount, stats }) {
  if (isLoading) {
    return (
      <DashboardGrid columns="4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </DashboardGrid>
    );
  }

  return (
    <DashboardGrid columns="4">
      {moduleGate.appointmentsEnabled ? (
        <>
          <StatCard
            title="Check-In Queue"
            value={checkInCount}
            subtitle="Waiting to check in"
            icon={Users}
            color="amber"
          />
          <StatCard
            title="Today's Appointments"
            value={stats.todays_appointments_count || 0}
            subtitle={`${stats.checked_in_count || 0} checked in`}
            icon={Calendar}
            color="sky"
          />
        </>
      ) : null}
      {moduleGate.patientRegistrationEnabled ? (
        <StatCard
          title="New Registrations"
          value={recentRegistrationCount}
          subtitle="Last 24 hours"
          icon={UserPlus}
          color="emerald"
        />
      ) : null}
      {moduleGate.billingEnabled ? (
        <StatCard
          title="Pending Payments"
          value={stats.pending_payments_count || 0}
          subtitle="Requires processing"
          icon={DollarSign}
          color="rose"
        />
      ) : null}
    </DashboardGrid>
  );
}

function CheckInQueueSection({
  isLoading,
  appointments,
  nowMs,
  checkInPatient,
  onViewAppointment,
}) {
  return (
    <DashboardSection
      title="Check-In Queue"
      subtitle="Patients with appointments today who haven't checked in"
    >
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : appointments.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-border bg-card/50">
          <CheckCircle className="size-12 text-emerald-400 mx-auto mb-3" />
          <p className="text-muted-foreground">All patients checked in</p>
        </div>
      ) : (
        <div className="space-y-3">
          {appointments.map((appointment) => (
            <ActionCard
              key={appointment.id}
              title={appointment.patient_name}
              subtitle={`MRN: ${appointment.patient_mrn || 'N/A'}`}
              description={`Appointment with ${appointment.practitioner_name}`}
              status={isAppointmentPast(appointment.start_time, nowMs) ? 'warning' : 'info'}
              badges={buildCheckInBadges(appointment, nowMs)}
              metadata={buildContactMetadata(appointment)}
              actions={[
                {
                  label: 'Check In',
                  variant: 'default',
                  onClick: () => checkInPatient.mutate({ appointmentId: appointment.id }),
                },
                {
                  label: 'View Details',
                  variant: 'outline',
                  onClick: () => onViewAppointment(appointment.id),
                },
              ]}
            />
          ))}
        </div>
      )}
    </DashboardSection>
  );
}

function isAppointmentPast(startTime, nowMs) {
  return Boolean(nowMs && startTime && Date.parse(startTime) < nowMs);
}

function buildCheckInBadges(appointment, nowMs) {
  return [
    {
      text: format(new Date(appointment.start_time), 'h:mm a'),
      color: isAppointmentPast(appointment.start_time, nowMs) ? 'rose' : 'sky',
    },
    appointment.appointment_type && {
      text: appointment.appointment_type,
      color: 'amber',
    },
  ].filter(Boolean);
}

function buildContactMetadata(record) {
  return [
    record.phone && {
      label: 'Phone',
      value: record.phone,
      icon: Phone,
    },
    record.email && {
      label: 'Email',
      value: record.email,
      icon: Mail,
    },
  ].filter(Boolean);
}

function TodaysAppointmentsSection({
  isLoading,
  appointments,
  onViewAll,
  onViewAppointment,
}) {
  return (
    <DashboardSection
      title="Today's Appointments"
      subtitle={`${appointments.length} appointments scheduled`}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={onViewAll}
        >
          View All
        </Button>
      }
    >
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : appointments.length === 0 ? (
        <div className="text-center py-8 rounded-xl border border-border bg-card/50">
          <Calendar className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No appointments scheduled for today</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {appointments.map((appointment) => (
            <AppointmentTile
              key={appointment.id}
              appointment={appointment}
              onViewAppointment={onViewAppointment}
            />
          ))}
        </div>
      )}
    </DashboardSection>
  );
}

function AppointmentTile({ appointment, onViewAppointment }) {
  return (
    <button
      type="button"
      aria-label={`View appointment for ${appointment.patient_name}`}
      className="w-full text-left rounded-xl border border-border bg-card p-4 hover:border-primary/30 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={() => onViewAppointment(appointment.id)}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-display text-base truncate">
            {appointment.patient_name}
          </h4>
          <p className="font-mono text-xs text-muted-foreground">
            {appointment.patient_mrn || 'N/A'}
          </p>
        </div>
        <span className={appointmentStatusClassName(appointment.status)}>
          {appointment.status}
        </span>
      </div>
      <div className="space-y-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Clock className="size-3" />
          <span>{format(new Date(appointment.start_time), 'h:mm a')}</span>
        </div>
        <div className="truncate">
          {appointment.practitioner_name}
        </div>
      </div>
    </button>
  );
}

function appointmentStatusClassName(status) {
  const tone = status === 'checked-in'
    ? 'bg-emerald-500/10 text-emerald-400'
    : status === 'completed'
    ? 'bg-sky-500/10 text-sky-400'
    : 'bg-amber-500/10 text-amber-400';

  return `text-xs font-mono px-2 py-1 rounded ${tone}`;
}

function RecentRegistrationsSection({
  isLoading,
  patients,
  moduleGate,
  onScheduleAppointment,
  onViewPatient,
}) {
  return (
    <DashboardSection
      title="Recent Registrations"
      subtitle="New patients registered in the last 24 hours"
    >
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : patients.length === 0 ? (
        <div className="text-center py-8 rounded-xl border border-border bg-card/50">
          <UserPlus className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No new registrations in the last 24 hours</p>
        </div>
      ) : (
        <div className="space-y-3">
          {patients.map((patient) => (
            <ActionCard
              key={patient.id}
              title={patient.full_name}
              subtitle={`MRN: ${patient.mrn}`}
              description={`Registered ${format(new Date(patient.created_at), 'MMM d, yyyy h:mm a')}`}
              badges={[{ text: 'NEW', color: 'emerald' }]}
              metadata={buildContactMetadata(patient)}
              actions={[
                moduleGate.appointmentsEnabled && {
                  label: 'Schedule Appointment',
                  variant: 'default',
                  onClick: () => onScheduleAppointment(patient.id),
                },
                moduleGate.patientChronicleEnabled && {
                  label: 'View Profile',
                  variant: 'outline',
                  onClick: () => onViewPatient(patient.id),
                },
              ].filter(Boolean)}
            />
          ))}
        </div>
      )}
    </DashboardSection>
  );
}
