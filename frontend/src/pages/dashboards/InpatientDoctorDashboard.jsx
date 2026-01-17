import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import UserCheck from 'lucide-react/dist/esm/icons/user-check.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import Inbox from 'lucide-react/dist/esm/icons/inbox.js';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/layout';
import { PageBreadcrumb } from '@/components/layout/PageBreadcrumb';
import {
  ChroniclePageHeader,
  StatCard,
  ActionCard,
  DashboardSection,
  DashboardGrid,
} from '@/components/dashboard';
import { WorkflowLauncher } from '@/components/workflow';
import { useInpatientDashboard } from '@/hooks/useDashboardQueries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import format from 'date-fns/format';
import formatDistanceToNow from 'date-fns/formatDistanceToNow';
import { useAuth } from '@/lib/auth';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';

export default function InpatientDoctorDashboard() {
  const navigate = useNavigate();
  const { facilityCode } = useAuth();

  // Fetch dashboard data with polling
  const {
    data: dashboardData,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useInpatientDashboard({ refetchInterval: 30000 });

  const breadcrumbItems = [
    { label: 'Dashboards', href: '/dashboards' },
    { label: 'Inpatient Dashboard', href: '/dashboards/inpatient' },
  ];

  if (!facilityCode) {
    return (
      <Layout>
        <PageBreadcrumb items={breadcrumbItems} />
        <FacilityRequiredPanel />
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="p-6">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6">
            <AlertTriangle className="h-6 w-6 text-rose-400 mb-2" />
            <h3 className="font-heading text-lg font-semibold text-rose-400 mb-1">
              Failed to load dashboard
            </h3>
            <p className="text-sm text-muted-foreground">{error.message}</p>
          </div>
        </div>
      </Layout>
    );
  }

  const newAdmissions = dashboardData?.new_admissions || [];
  const myPatients = dashboardData?.my_patients || [];
  const plannedDischarges = dashboardData?.planned_discharges || [];
  const pending = dashboardData?.pending || {};

  return (
    <Layout>
      <PageBreadcrumb items={breadcrumbItems} />

      <ChroniclePageHeader
        title="Inpatient Dashboard"
        role="inpatient_doctor"
        subtitle="Manage ward patients, rounds, and discharges"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/referrals/sent')}
            >
              <Send className="h-4 w-4 mr-2" />
              Sent Referrals
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/referrals/inbox')}
            >
              <Inbox className="h-4 w-4 mr-2" />
              Referral Inbox
            </Button>
            <WorkflowLauncher
              variant="default"
              size="sm"
              trigger={
                <Button variant="default" size="sm">
                  <Stethoscope className="h-4 w-4 mr-2" />
                  Start Workflow
                </Button>
              }
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </>
        }
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
              title="New Admissions"
              value={newAdmissions.length}
              subtitle="Last 24 hours"
              icon={UserPlus}
              color="amber"
            />
            <StatCard
              title="My Patients"
              value={myPatients.length}
              subtitle="Currently admitted"
              icon={Users}
              color="emerald"
            />
            <StatCard
              title="Planned Discharges"
              value={plannedDischarges.length}
              subtitle="Today"
              icon={UserCheck}
              color="sky"
            />
            <StatCard
              title="Pending Items"
              value={(pending.results_to_review || 0) + (pending.orders_to_sign || 0)}
              subtitle="Requiring attention"
              icon={FileText}
              color="rose"
            />
          </DashboardGrid>
        )}

        {/* New Admissions */}
        <DashboardSection
          title="New Admissions"
          subtitle="Patients admitted in the last 24 hours"
        >
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(2)].map((_, i) => (
                <Skeleton key={i} className="h-40" />
              ))}
            </div>
          ) : newAdmissions.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-border bg-card/50">
              <UserPlus className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No new admissions in the last 24 hours</p>
            </div>
          ) : (
            <DashboardGrid columns="2">
              {newAdmissions.map((admission) => (
                <ActionCard
                  key={admission.id}
                  title={admission.patient_name}
                  subtitle={`MRN: ${admission.mrn}`}
                  description={admission.admission_reason || 'No admission reason recorded'}
                  status="info"
                  badges={[
                    {
                      text: 'NEW',
                      color: 'amber',
                    },
                  ]}
                  metadata={[
                    {
                      label: 'Ward/Bed',
                      value: `${admission.ward_name} - Bed ${admission.bed_number}`,
                      icon: Bed,
                    },
                    {
                      label: 'Admitted',
                      value: formatDistanceToNow(new Date(admission.admission_date), {
                        addSuffix: true,
                      }),
                      icon: Clock,
                    },
                    {
                      label: 'LOS',
                      value: `${admission.length_of_stay} ${
                        admission.length_of_stay === 1 ? 'day' : 'days'
                      }`,
                      icon: Calendar,
                    },
                  ]}
                  actions={[
                    {
                      label: 'Start Ward Round',
                      variant: 'default',
                      onClick: () => {
                        // Start ward round workflow
                        console.log('Start ward round:', admission.id);
                      },
                    },
                    {
                      label: 'View Details',
                      variant: 'outline',
                      onClick: () => navigate(`/patients/${admission.patient_id}`),
                    },
                  ]}
                  onClick={() => navigate(`/patients/${admission.patient_id}`)}
                />
              ))}
            </DashboardGrid>
          )}
        </DashboardSection>

        {/* My Patients */}
        <DashboardSection
          title="My Patients"
          subtitle={`${myPatients.length} active patients under your care`}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/patients')}
            >
              View All
            </Button>
          }
        >
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-36" />
              ))}
            </div>
          ) : myPatients.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-border bg-card/50">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No active patients</p>
            </div>
          ) : (
            <DashboardGrid columns="2">
              {myPatients.map((patient) => (
                <ActionCard
                  key={patient.id}
                  title={patient.patient_name}
                  subtitle={`MRN: ${patient.mrn}`}
                  description={patient.diagnosis || 'No diagnosis recorded'}
                  status={
                    patient.estimated_discharge &&
                    new Date(patient.estimated_discharge) <= new Date()
                      ? 'warning'
                      : 'stable'
                  }
                  badges={[
                    patient.estimated_discharge && {
                      text: `Discharge: ${format(
                        new Date(patient.estimated_discharge),
                        'MMM d'
                      )}`,
                      color: 'sky',
                    },
                  ].filter(Boolean)}
                  metadata={[
                    {
                      label: 'Ward/Bed',
                      value: `${patient.ward_name} - Bed ${patient.bed_number}`,
                      icon: Bed,
                    },
                    {
                      label: 'LOS',
                      value: `${patient.length_of_stay} ${
                        patient.length_of_stay === 1 ? 'day' : 'days'
                      }`,
                      icon: Calendar,
                    },
                    patient.last_round_date && {
                      label: 'Last Round',
                      value: formatDistanceToNow(new Date(patient.last_round_date), {
                        addSuffix: true,
                      }),
                      icon: Activity,
                    },
                  ].filter(Boolean)}
                  actions={[
                    {
                      label: 'Ward Round',
                      variant: 'default',
                      onClick: () => console.log('Start ward round:', patient.id),
                    },
                    {
                      label: 'View Chart',
                      variant: 'outline',
                      onClick: () => navigate(`/patients/${patient.patient_id}`),
                    },
                  ]}
                  onClick={() => navigate(`/patients/${patient.patient_id}`)}
                />
              ))}
            </DashboardGrid>
          )}
        </DashboardSection>

        {/* Planned Discharges */}
        <DashboardSection
          title="Planned Discharges"
          subtitle="Patients scheduled for discharge today"
        >
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(2)].map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          ) : plannedDischarges.length === 0 ? (
            <div className="text-center py-8 rounded-xl border border-border bg-card/50">
              <UserCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No discharges planned for today</p>
            </div>
          ) : (
            <div className="space-y-3">
              {plannedDischarges.map((discharge) => (
                <ActionCard
                  key={discharge.id}
                  title={discharge.patient_name}
                  subtitle={`MRN: ${discharge.mrn}`}
                  description={`Admitted for ${discharge.length_of_stay} ${
                    discharge.length_of_stay === 1 ? 'day' : 'days'
                  }`}
                  status="info"
                  badges={[
                    {
                      text: 'DISCHARGE TODAY',
                      color: 'sky',
                    },
                  ]}
                  metadata={[
                    {
                      label: 'Ward/Bed',
                      value: `${discharge.ward_name} - Bed ${discharge.bed_number}`,
                      icon: Bed,
                    },
                    {
                      label: 'Estimated',
                      value: discharge.estimated_discharge
                        ? format(new Date(discharge.estimated_discharge), 'MMM d, yyyy')
                        : 'Not specified',
                      icon: Calendar,
                    },
                  ]}
                  actions={[
                    {
                      label: 'Start Discharge',
                      variant: 'default',
                      onClick: () => console.log('Start discharge:', discharge.id),
                    },
                    {
                      label: 'View Details',
                      variant: 'outline',
                      onClick: () => navigate(`/patients/${discharge.patient_id}`),
                    },
                  ]}
                />
              ))}
            </div>
          )}
        </DashboardSection>
      </div>
    </Layout>
  );
}
