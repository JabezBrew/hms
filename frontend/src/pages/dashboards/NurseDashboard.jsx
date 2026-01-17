import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/layout';
import { PageBreadcrumb } from '@/components/layout/PageBreadcrumb';
import {
  ChroniclePageHeader,
  UrgentBanner,
  StatCard,
  ActionCard,
  DashboardSection,
  DashboardGrid,
} from '@/components/dashboard';
import { WorkflowLauncher } from '@/components/workflow';
import { useNurseDashboard } from '@/hooks/useDashboardQueries';
import { useDashboardActions } from '@/hooks/useDashboardActions';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import format from 'date-fns/format';
import { useWards } from '@/hooks/useWardQueries';
import { useAuth } from '@/lib/auth';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';

export default function NurseDashboard() {
  const navigate = useNavigate();
  const [selectedWard, setSelectedWard] = useState('all');
  const { facilityCode } = useAuth();

  // Fetch ward list
  const { data: wardsData } = useWards();
  const wards = wardsData || [];

  // Fetch dashboard data with polling
  const {
    data: dashboardData,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useNurseDashboard(
    selectedWard && selectedWard !== 'all' ? { ward: selectedWard } : {},
    { refetchInterval: 30000 }
  );

  // Action handlers
  const {
    administerMedication,
    completeTask,
    acknowledgeAlert,
    recordVitals,
  } = useDashboardActions();

  const breadcrumbItems = [
    { label: 'Dashboards', href: '/dashboards' },
    { label: 'Nurse Dashboard', href: '/dashboards/nurse' },
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

  const urgent = dashboardData?.urgent || { critical_alerts: [], overdue_medications: [], count: 0 };
  const shiftPatients = dashboardData?.shift_patients || [];
  const medicationsSchedule = dashboardData?.medications_schedule || [];
  const tasks = dashboardData?.tasks || [];

  // Prepare urgent items for banner
  const urgentItems = [
    ...urgent.critical_alerts.map((alert) => ({
      id: alert.id,
      label: 'ALERT',
      patient_name: alert.patient_name,
      description: alert.message,
      time: format(new Date(alert.created_at), 'h:mm a'),
      badge: alert.severity.toUpperCase(),
    })),
    ...urgent.overdue_medications.map((med) => ({
      id: med.id,
      label: 'OVERDUE MED',
      patient_name: med.patient_name,
      description: `${med.medication_name} - Scheduled: ${format(new Date(med.scheduled_time), 'h:mm a')}`,
      time: `${Math.floor((new Date() - new Date(med.scheduled_time)) / 60000)} min late`,
      badge: 'OVERDUE',
    })),
  ];

  return (
    <Layout>
      <PageBreadcrumb items={breadcrumbItems} />

      <ChroniclePageHeader
        title="Nurse Dashboard"
        role="nurse"
        subtitle="Monitor patients, administer medications, and manage tasks"
        actions={
          <>
            <Select value={selectedWard} onValueChange={setSelectedWard}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Wards" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Wards</SelectItem>
                {wards.map((ward) => (
                  <SelectItem key={ward.id} value={ward.id}>
                    {ward.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
        {/* Urgent Banner */}
        {urgent.count > 0 && (
          <UrgentBanner
            items={urgentItems}
            severity="critical"
            title="Urgent Items"
            onItemClick={(item) => {
              // Navigate to patient detail or handle alert
              console.log('Urgent item clicked:', item);
            }}
          />
        )}

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
              title="Shift Patients"
              value={shiftPatients.length}
              subtitle="Active patients in ward"
              icon={Users}
              color="amber"
            />
            <StatCard
              title="Critical Alerts"
              value={urgent.critical_alerts.length}
              subtitle="Requiring immediate attention"
              icon={AlertTriangle}
              color="rose"
            />
            <StatCard
              title="Medications Due"
              value={medicationsSchedule.length}
              subtitle="Next 2 hours"
              icon={Pill}
              color="sky"
            />
            <StatCard
              title="Pending Tasks"
              value={tasks.length}
              subtitle="Today's remaining tasks"
              icon={ClipboardList}
              color="emerald"
            />
          </DashboardGrid>
        )}

        {/* Shift Patients */}
        <DashboardSection
          title="Shift Patients"
          subtitle={`${shiftPatients.length} patients currently assigned`}
        >
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-40" />
              ))}
            </div>
          ) : shiftPatients.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-border bg-card/50">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No patients assigned to this shift</p>
            </div>
          ) : (
            <DashboardGrid columns="2">
              {shiftPatients.map((patient) => (
                <ActionCard
                  key={patient.patient_id}
                  title={patient.patient_name}
                  subtitle={`MRN: ${patient.mrn}`}
                  description={patient.diagnosis || 'No diagnosis recorded'}
                  status={
                    patient.has_critical_alerts
                      ? 'critical'
                      : patient.alerts_count > 0
                      ? 'warning'
                      : 'stable'
                  }
                  badges={[
                    patient.alerts_count > 0 && {
                      text: `${patient.alerts_count} Alert${patient.alerts_count > 1 ? 's' : ''}`,
                      color: 'rose',
                    },
                    patient.tasks_count > 0 && {
                      text: `${patient.tasks_count} Task${patient.tasks_count > 1 ? 's' : ''}`,
                      color: 'amber',
                    },
                  ].filter(Boolean)}
                  metadata={[
                    {
                      label: 'Ward/Bed',
                      value: `${patient.ward_name} - Bed ${patient.bed_number}`,
                      icon: Bed,
                    },
                    {
                      label: 'Admission',
                      value: format(new Date(patient.admission_date), 'MMM d, yyyy'),
                      icon: Clock,
                    },
                    patient.latest_vitals && {
                      label: 'Last Vitals',
                      value: format(new Date(patient.latest_vitals.recorded_at), 'h:mm a'),
                      icon: Activity,
                    },
                  ].filter(Boolean)}
                  actions={[
                    {
                      label: 'Record Vitals',
                      variant: 'default',
                      onClick: () => navigate(`/patients/${patient.patient_id}`),
                    },
                    {
                      label: 'View Details',
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

        {/* Medications Schedule */}
        <DashboardSection
          title="Medications Schedule"
          subtitle="Due in the next 2 hours"
        >
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : medicationsSchedule.length === 0 ? (
            <div className="text-center py-8 rounded-xl border border-border bg-card/50">
              <Pill className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No medications due in the next 2 hours</p>
            </div>
          ) : (
            <div className="space-y-3">
              {medicationsSchedule.map((med) => (
                <ActionCard
                  key={med.id}
                  title={med.medication_name}
                  subtitle={med.patient_name}
                  description={`${med.dosage} ${med.route} - ${med.frequency}`}
                  badges={[
                    {
                      text: format(new Date(med.scheduled_time), 'h:mm a'),
                      color: 'sky',
                    },
                  ]}
                  metadata={[
                    {
                      label: 'Ward/Bed',
                      value: `${med.ward_name} - Bed ${med.bed_number}`,
                      icon: Bed,
                    },
                  ]}
                  actions={[
                    {
                      label: 'Administer',
                      variant: 'default',
                      onClick: () =>
                        administerMedication.mutate({
                          medicationId: med.id,
                          administrationData: {
                            administered_at: new Date().toISOString(),
                            status: 'administered',
                          },
                        }),
                    },
                  ]}
                />
              ))}
            </div>
          )}
        </DashboardSection>

        {/* Pending Tasks */}
        <DashboardSection
          title="Pending Tasks"
          subtitle="Today's remaining tasks"
        >
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-8 rounded-xl border border-border bg-card/50">
              <ClipboardList className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No pending tasks for today</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => (
                <ActionCard
                  key={task.id}
                  title={task.title}
                  subtitle={task.patient_name}
                  description={task.description}
                  badges={[
                    {
                      text: task.priority.toUpperCase(),
                      color: task.priority === 'high' ? 'rose' : 'amber',
                    },
                  ]}
                  metadata={[
                    {
                      label: 'Due',
                      value: format(new Date(task.due_at), 'h:mm a'),
                      icon: Clock,
                    },
                  ]}
                  actions={[
                    {
                      label: 'Complete',
                      variant: 'default',
                      onClick: () =>
                        completeTask.mutate({
                          taskId: task.id,
                          completionNotes: `Completed via dashboard at ${new Date().toLocaleString()}`,
                        }),
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
