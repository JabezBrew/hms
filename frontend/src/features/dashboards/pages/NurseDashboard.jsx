import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/layout';
import {
  UrgentBanner,
  StatCard,
  ActionCard,
  DashboardSection,
  DashboardGrid,
} from '@/components/dashboard';
import {
  useDashboardModuleGates,
  useDashboardActions,
  useNurseDashboard,
  useNurseDashboardLiveUpdates,
} from '@/features/dashboards/hooks';
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
import { useWards } from '@/features/wards/hooks/useWardQueries';
import { useAuth } from '@/lib/auth';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';

export default function NurseDashboard() {
  const navigate = useNavigate();
  const [selectedWard, setSelectedWard] = useState('all');
  const { facilityCode } = useAuth();
  const moduleGate = useDashboardModuleGates({ enabled: Boolean(facilityCode) });
  const dashboardEnabled = Boolean(facilityCode) && moduleGate.nursingWorkflowsEnabled;
  const canOpenWardBoard = moduleGate.canUse([
    'ward_task_board',
    'patient_chronicle',
    'wards',
    'inpatient_admissions',
    'nursing_workflows',
  ]);
  const wardBoardHref = selectedWard && selectedWard !== 'all'
    ? `/ward-board?ward=${encodeURIComponent(selectedWard)}`
    : '/ward-board';

  const wardFilters = moduleGate.wardsEnabled && selectedWard && selectedWard !== 'all'
    ? { ward: selectedWard }
    : {};
  const { isConnected: isLiveConnected } = useNurseDashboardLiveUpdates({
    enabled: dashboardEnabled,
    wardScope: selectedWard,
  });

  // Fetch dashboard data with websocket-triggered refresh, polling fallback.
  const {
    data: dashboardData,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useNurseDashboard(wardFilters, {
    refetchInterval: isLiveConnected ? false : 30000,
    enabled: dashboardEnabled,
  });

  // Action handlers
  const {
    administerMedication,
    completeTask,
  } = useDashboardActions();

  useEffect(() => {
    if (!moduleGate.wardsEnabled && selectedWard !== 'all') {
      setSelectedWard('all');
    }
  }, [moduleGate.wardsEnabled, selectedWard]);

  if (!facilityCode) {
    return (
      <Layout>
        <PageShell>
          <PageHeader
            title="Nurse Dashboard"
            description="Monitor patients, administer medications, and manage tasks"
            actions={moduleGate.wardsEnabled ? (
              <WardFilterSelect selectedWard={selectedWard} onSelectedWardChange={setSelectedWard} />
            ) : null}
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
            title="Nurse Dashboard"
            description="Monitor patients, administer medications, and manage tasks"
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
            title="Nurse Dashboard"
            description="Monitor patients, administer medications, and manage tasks"
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

  if (!moduleGate.nursingWorkflowsEnabled) {
    return (
      <Layout>
        <PageShell>
          <PageHeader
            title="Nurse Dashboard"
            description="Monitor patients, administer medications, and manage tasks"
          />
          <PageState
            variant="empty"
            title="Nurse dashboard disabled"
            description="Nursing workflows are not enabled for this deployment."
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
            title="Nurse Dashboard"
            description="Monitor patients, administer medications, and manage tasks"
            actions={moduleGate.wardsEnabled ? (
              <WardFilterSelect selectedWard={selectedWard} onSelectedWardChange={setSelectedWard} />
            ) : null}
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

  const urgent = dashboardData?.urgent || { critical_alerts: [], overdue_medications: [], count: 0 };
  const shiftPatients = dashboardData?.shift_patients || [];
  const medicationsSchedule = dashboardData?.medications_schedule || [];
  const tasks = dashboardData?.tasks || [];

  // Prepare urgent items for banner
  const urgentItems = [
    ...urgent.critical_alerts.map((alert) => ({
      id: alert.id,
      patient_id: alert.patient_id,
      label: 'ALERT',
      patient_name: alert.patient_name,
      description: alert.message,
      time: format(new Date(alert.created_at), 'h:mm a'),
      badge: alert.severity.toUpperCase(),
    })),
    ...(moduleGate.pharmacyEnabled ? urgent.overdue_medications.map((med) => ({
      id: med.id,
      patient_id: med.patient_id,
      label: 'OVERDUE MED',
      patient_name: med.patient_name,
      description: `${med.medication_name} - Scheduled: ${format(new Date(med.scheduled_time), 'h:mm a')}`,
      time: `${Math.floor((new Date() - new Date(med.scheduled_time)) / 60000)} min late`,
      badge: 'OVERDUE',
    })) : []),
  ];

  return (
    <Layout>
      <PageShell>
        <PageHeader
          title="Nurse Dashboard"
          description="Monitor patients, administer medications, and manage tasks"
          actions={(
            <div className="flex items-center gap-2">
              {moduleGate.wardsEnabled ? (
                <WardFilterSelect selectedWard={selectedWard} onSelectedWardChange={setSelectedWard} />
              ) : null}
              {canOpenWardBoard ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(wardBoardHref)}
                >
                  <ClipboardList className="h-4 w-4 mr-2" />
                  Open Ward Board
                </Button>
              ) : null}
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
        {/* Urgent Banner */}
        {urgentItems.length > 0 && (
          <UrgentBanner
            items={urgentItems}
            severity="critical"
            title="Urgent Items"
            onItemClick={(item) => {
              if (moduleGate.patientChronicleEnabled && item.patient_id) {
                navigate(`/patients/${item.patient_id}`);
              }
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
            {moduleGate.pharmacyEnabled ? (
              <StatCard
                title="Medications Due"
                value={medicationsSchedule.length}
                subtitle="Next 2 hours"
                icon={Pill}
                color="sky"
              />
            ) : null}
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
                    moduleGate.wardsEnabled && {
                      label: 'Ward/Bed',
                      value: `${patient.ward_name} - Bed ${patient.bed_number}`,
                      icon: Bed,
                    },
                    moduleGate.inpatientAdmissionsEnabled && {
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
                    moduleGate.patientChronicleEnabled && {
                      label: 'Record Vitals',
                      variant: 'default',
                      onClick: () => navigate(`/patients/${patient.patient_id}`),
                    },
                    moduleGate.patientChronicleEnabled && {
                      label: 'View Details',
                      variant: 'outline',
                      onClick: () => navigate(`/patients/${patient.patient_id}`),
                    },
                  ].filter(Boolean)}
                  onClick={moduleGate.patientChronicleEnabled ? () => navigate(`/patients/${patient.patient_id}`) : undefined}
                />
              ))}
            </DashboardGrid>
          )}
        </DashboardSection>

        {/* Medications Schedule */}
        {moduleGate.pharmacyEnabled ? (
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
        ) : null}

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
      </PageShell>
    </Layout>
  );
}

function WardFilterSelect({ selectedWard, onSelectedWardChange }) {
  const { data: wardsData } = useWards();
  const wards = wardsData || [];

  return (
    <Select value={selectedWard} onValueChange={onSelectedWardChange}>
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
  );
}
