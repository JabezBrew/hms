import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import Mail from 'lucide-react/dist/esm/icons/mail.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/layout';
import {
  StatCard,
  ActionCard,
  DashboardSection,
  DashboardGrid,
} from '@/components/dashboard';
import {
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
  const { isConnected: isLiveConnected } = useReceptionDashboardLiveUpdates({
    enabled: Boolean(facilityCode),
  });

  // Fetch dashboard data with websocket-triggered refresh, polling fallback.
  const {
    data: dashboardData,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useReceptionistDashboard({ refetchInterval: isLiveConnected ? false : 30000 });

  // Action handlers
  const { checkInPatient, scheduleAppointment } = useDashboardActions();

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
              <Button
                variant="default"
                size="sm"
                onClick={() => navigate('/patients/create')}
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Register Patient
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/triage')}
              >
                <ClipboardList className="h-4 w-4 mr-2" />
                Triage Queue
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetch()}
                disabled={isFetching}
                aria-label="Refresh dashboard"
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
              </Button>
            </div>
          )}
        />

        <div className="p-4 sm:p-6 space-y-6 sm:space-y-8">
        {/* Statistics */}
        {isLoading ? (
          <DashboardGrid columns="4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </DashboardGrid>
        ) : (
          <DashboardGrid columns="4">
            <StatCard
              title="Check-In Queue"
              value={checkInQueue.length}
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
            <StatCard
              title="New Registrations"
              value={recentRegistrations.length}
              subtitle="Last 24 hours"
              icon={UserPlus}
              color="emerald"
            />
            <StatCard
              title="Pending Payments"
              value={stats.pending_payments_count || 0}
              subtitle="Requires processing"
              icon={DollarSign}
              color="rose"
            />
          </DashboardGrid>
        )}

        {/* Check-In Queue */}
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
          ) : checkInQueue.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-border bg-card/50">
              <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
              <p className="text-muted-foreground">All patients checked in</p>
            </div>
          ) : (
            <div className="space-y-3">
              {checkInQueue.map((appointment) => (
                <ActionCard
                  key={appointment.id}
                  title={appointment.patient_name}
                  subtitle={`MRN: ${appointment.patient_mrn || 'N/A'}`}
                  description={`Appointment with ${appointment.practitioner_name}`}
                  status={
                    new Date(appointment.start_time) < new Date()
                      ? 'warning'
                      : 'info'
                  }
                  badges={[
                    {
                      text: format(new Date(appointment.start_time), 'h:mm a'),
                      color:
                        new Date(appointment.start_time) < new Date()
                          ? 'rose'
                          : 'sky',
                    },
                    appointment.appointment_type && {
                      text: appointment.appointment_type,
                      color: 'amber',
                    },
                  ].filter(Boolean)}
                  metadata={[
                    appointment.phone && {
                      label: 'Phone',
                      value: appointment.phone,
                      icon: Phone,
                    },
                    appointment.email && {
                      label: 'Email',
                      value: appointment.email,
                      icon: Mail,
                    },
                  ].filter(Boolean)}
                  actions={[
                    {
                      label: 'Check In',
                      variant: 'default',
                      onClick: () =>
                        checkInPatient.mutate({ appointmentId: appointment.id }),
                    },
                    {
                      label: 'View Details',
                      variant: 'outline',
                      onClick: () => navigate(`/appointments/${appointment.id}`),
                    },
                  ]}
                />
              ))}
            </div>
          )}
        </DashboardSection>

        {/* Today's Appointments */}
        <DashboardSection
          title="Today's Appointments"
          subtitle={`${todaysAppointments.length} appointments scheduled`}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/appointments')}
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
          ) : todaysAppointments.length === 0 ? (
            <div className="text-center py-8 rounded-xl border border-border bg-card/50">
              <Calendar className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No appointments scheduled for today</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {todaysAppointments.map((appointment) => (
                <div
                  key={appointment.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`View appointment for ${appointment.patient_name}`}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/appointments/${appointment.id}`); } }}
                  className="rounded-xl border border-border bg-card p-4 hover:border-primary/30 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => navigate(`/appointments/${appointment.id}`)}
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
                    <span
                      className={`text-xs font-mono px-2 py-1 rounded ${
                        appointment.status === 'checked-in'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : appointment.status === 'completed'
                          ? 'bg-sky-500/10 text-sky-400'
                          : 'bg-amber-500/10 text-amber-400'
                      }`}
                    >
                      {appointment.status}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      <span>{format(new Date(appointment.start_time), 'h:mm a')}</span>
                    </div>
                    <div className="truncate">
                      {appointment.practitioner_name}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DashboardSection>

        {/* Recent Registrations */}
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
          ) : recentRegistrations.length === 0 ? (
            <div className="text-center py-8 rounded-xl border border-border bg-card/50">
              <UserPlus className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No new registrations in the last 24 hours</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentRegistrations.map((patient) => (
                <ActionCard
                  key={patient.id}
                  title={patient.full_name}
                  subtitle={`MRN: ${patient.mrn}`}
                  description={`Registered ${format(
                    new Date(patient.created_at),
                    'MMM d, yyyy h:mm a'
                  )}`}
                  badges={[
                    {
                      text: 'NEW',
                      color: 'emerald',
                    },
                  ]}
                  metadata={[
                    patient.phone && {
                      label: 'Phone',
                      value: patient.phone,
                      icon: Phone,
                    },
                    patient.email && {
                      label: 'Email',
                      value: patient.email,
                      icon: Mail,
                    },
                  ].filter(Boolean)}
                  actions={[
                    {
                      label: 'Schedule Appointment',
                      variant: 'default',
                      onClick: () => navigate(`/appointments/create?patient=${patient.id}`),
                    },
                    {
                      label: 'View Profile',
                      variant: 'outline',
                      onClick: () => navigate(`/patients/${patient.id}`),
                    },
                  ]}
                />
              ))}
            </div>
          )}
        </DashboardSection>
        </div>
      </PageShell>
    </Layout>
  );
}
