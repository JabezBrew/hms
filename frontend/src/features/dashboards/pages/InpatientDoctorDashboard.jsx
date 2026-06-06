import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import UserCheck from 'lucide-react/dist/esm/icons/user-check.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import Inbox from 'lucide-react/dist/esm/icons/inbox.js';
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
import { WorkflowLauncher } from '@/components/workflow';
import {
  useDashboardModuleGates,
  useInpatientDashboard,
  useInpatientDashboardLiveUpdates,
} from '@/features/dashboards/hooks';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Skeleton } from '@/components/ui/skeleton';

import format from 'date-fns/format';
import formatDistanceToNow from 'date-fns/formatDistanceToNow';
import { useAuth } from '@/lib/auth';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';

function dischargeWardBoardPath(discharge) {
  const params = new URLSearchParams({ view: 'discharge' });
  if (discharge?.patient_id) params.set('patient', discharge.patient_id);
  if (discharge?.id) params.set('case', discharge.id);
  const wardId = discharge?.ward_id || discharge?.ward || discharge?.admission_ward_id || null;
  const basePath = wardId ? `/wards/${wardId}/board` : '/ward-board';
  return `${basePath}?${params.toString()}`;
}

export default function InpatientDoctorDashboard() {
  const navigate = useNavigate();
  const { facilityCode } = useAuth();
  const moduleGate = useDashboardModuleGates({ enabled: Boolean(facilityCode) });
  const dashboardEnabled = Boolean(facilityCode) && moduleGate.inpatientAdmissionsEnabled;
  const { isConnected: isLiveConnected } = useInpatientDashboardLiveUpdates({
    enabled: dashboardEnabled,
  });

  // Fetch dashboard data with websocket-triggered refresh, polling fallback.
  const {
    data: dashboardData,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useInpatientDashboard({
    refetchInterval: isLiveConnected ? false : 30000,
    enabled: dashboardEnabled,
  });
  const generatedAt = dashboardData?.meta?.generated_at;
  const generatedAtMs = useMemo(() => getDashboardNowMs(generatedAt), [generatedAt]);
  const canUseReferrals = moduleGate.referralsEnabled;
  const canUsePatientChronicle = moduleGate.patientChronicleEnabled;
  const canUseWardRound = moduleGate.wardsEnabled && canUsePatientChronicle;
  const canUseDischarge = moduleGate.dischargeWorkflowsEnabled && canUsePatientChronicle;
  const canShowWorkflowLauncher = moduleGate.wardsEnabled && moduleGate.dischargeWorkflowsEnabled;
  const canOpenWardBoard = moduleGate.canUse([
    'ward_task_board',
    'patient_chronicle',
    'wards',
    'inpatient_admissions',
    'nursing_workflows',
  ]);

  if (!facilityCode) {
    return (
      <Layout>
        <PageShell>
          <PageHeader
            title="Inpatient Dashboard"
            description="Manage ward patients, rounds, and discharges"
            actions={canUseReferrals ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/referrals/sent')}
                >
                  <Send className="size-4 mr-2" />
                  Sent Referrals
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/referrals/inbox')}
                >
                  <Inbox className="size-4 mr-2" />
                  Referral Inbox
                </Button>
              </div>
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
            title="Inpatient Dashboard"
            description="Manage ward patients, rounds, and discharges"
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
            title="Inpatient Dashboard"
            description="Manage ward patients, rounds, and discharges"
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

  if (!moduleGate.inpatientAdmissionsEnabled) {
    return (
      <Layout>
        <PageShell>
          <PageHeader
            title="Inpatient Dashboard"
            description="Manage ward patients, rounds, and discharges"
          />
          <PageState
            variant="empty"
            title="Inpatient dashboard disabled"
            description="Inpatient admissions are not enabled for this deployment."
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
            title="Inpatient Dashboard"
            description="Manage ward patients, rounds, and discharges"
            actions={canUseReferrals ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/referrals/sent')}
                >
                  <Send className="size-4 mr-2" />
                  Sent Referrals
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/referrals/inbox')}
                >
                  <Inbox className="size-4 mr-2" />
                  Referral Inbox
                </Button>
              </div>
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

  const newAdmissions = dashboardData?.new_admissions || [];
  const myPatients = dashboardData?.my_patients || [];
  const plannedDischarges = dashboardData?.planned_discharges || [];
  const pending = dashboardData?.pending || {};
  const openWardRound = (patientId) => {
    if (!patientId) {
      return;
    }
    navigate(`/patients/${patientId}?action=ward_round`);
  };

  return (
    <Layout>
      <PageShell>
        <PageHeader
          title="Inpatient Dashboard"
          description="Manage ward patients, rounds, and discharges"
          actions={(
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {canUseReferrals ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/referrals/sent')}
                  >
                    <Send className="size-4 mr-2" />
                    Sent Referrals
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/referrals/inbox')}
                  >
                    <Inbox className="size-4 mr-2" />
                    Referral Inbox
                  </Button>
                </>
              ) : null}
              {canShowWorkflowLauncher ? (
                <WorkflowLauncher
                  variant="default"
                  size="sm"
                  trigger={
                    <Button variant="default" size="sm">
                      <Stethoscope className="size-4 mr-2" />
                      Start Workflow
                    </Button>
                  }
                />
              ) : null}
              {canOpenWardBoard ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/ward-board')}
                >
                  <ClipboardList className="size-4 mr-2" />
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
                {isFetching ? (
                  <LoadingSpinner className="h-4 w-8" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>
          )}
        />

        <div className="p-4 sm:p-6 space-y-6 sm:space-y-8">
          <InpatientStats
            isLoading={isLoading}
            newAdmissionCount={newAdmissions.length}
            patientCount={myPatients.length}
            plannedDischargeCount={plannedDischarges.length}
            pendingCount={(pending.results_to_review || 0) + (pending.orders_to_sign || 0)}
            dischargeWorkflowsEnabled={moduleGate.dischargeWorkflowsEnabled}
          />

          {/* New Admissions */}
          <NewAdmissionsSection
            isLoading={isLoading}
            admissions={newAdmissions}
            moduleGate={moduleGate}
            canUseWardRound={canUseWardRound}
            canUsePatientChronicle={canUsePatientChronicle}
            onOpenWardRound={openWardRound}
            onViewPatient={(patientId) => navigate(`/patients/${patientId}`)}
          />

          {/* My Patients */}
          <MyPatientsSection
            isLoading={isLoading}
            patients={myPatients}
            moduleGate={moduleGate}
            nowMs={generatedAtMs}
            canUseWardRound={canUseWardRound}
            canUsePatientChronicle={canUsePatientChronicle}
            onOpenWardRound={openWardRound}
            onViewAll={() => navigate('/patients')}
            onViewPatient={(patientId) => navigate(`/patients/${patientId}`)}
          />

          {/* Planned Discharges */}
          {moduleGate.dischargeWorkflowsEnabled ? (
            <PlannedDischargesSection
              isLoading={isLoading}
              discharges={plannedDischarges}
              moduleGate={moduleGate}
              canUseDischarge={canUseDischarge}
              canUsePatientChronicle={canUsePatientChronicle}
              onStartDischarge={(discharge) => navigate(dischargeWardBoardPath(discharge))}
              onViewPatient={(patientId) => navigate(`/patients/${patientId}`)}
            />
          ) : null}
        </div>
      </PageShell>
    </Layout>
  );
}

function InpatientStats({
  isLoading,
  newAdmissionCount,
  patientCount,
  plannedDischargeCount,
  pendingCount,
  dischargeWorkflowsEnabled,
}) {
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
      <StatCard
        title="New Admissions"
        value={newAdmissionCount}
        subtitle="Last 24 hours"
        icon={UserPlus}
        color="amber"
      />
      <StatCard
        title="My Patients"
        value={patientCount}
        subtitle="Currently admitted"
        icon={Users}
        color="emerald"
      />
      {dischargeWorkflowsEnabled ? (
        <StatCard
          title="Planned Discharges"
          value={plannedDischargeCount}
          subtitle="Today"
          icon={UserCheck}
          color="sky"
        />
      ) : null}
      <StatCard
        title="Pending Items"
        value={pendingCount}
        subtitle="Requiring attention"
        icon={FileText}
        color="rose"
      />
    </DashboardGrid>
  );
}

function getDashboardNowMs(value) {
  if (!value) {
    return Date.now();
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function NewAdmissionsSection({
  isLoading,
  admissions,
  moduleGate,
  canUseWardRound,
  canUsePatientChronicle,
  onOpenWardRound,
  onViewPatient,
}) {
  return (
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
      ) : admissions.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-border bg-card/50">
          <UserPlus className="size-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No new admissions in the last 24 hours</p>
        </div>
      ) : (
        <DashboardGrid columns="2">
          {admissions.map((admission) => (
            <ActionCard
              key={admission.id}
              title={admission.patient_name}
              subtitle={`MRN: ${admission.mrn}`}
              description={admission.admission_reason || 'No admission reason recorded'}
              status="info"
              badges={[{ text: 'NEW', color: 'amber' }]}
              metadata={buildAdmissionMetadata(admission, moduleGate)}
              actions={buildAdmissionActions(
                admission,
                canUseWardRound,
                canUsePatientChronicle,
                onOpenWardRound,
                onViewPatient,
              )}
              onClick={canUsePatientChronicle ? () => onViewPatient(admission.patient_id) : undefined}
            />
          ))}
        </DashboardGrid>
      )}
    </DashboardSection>
  );
}

function buildAdmissionMetadata(admission, moduleGate) {
  return [
    moduleGate.wardsEnabled && {
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
      value: `${admission.length_of_stay} ${admission.length_of_stay === 1 ? 'day' : 'days'}`,
      icon: Calendar,
    },
  ].filter(Boolean);
}

function buildAdmissionActions(
  admission,
  canUseWardRound,
  canUsePatientChronicle,
  onOpenWardRound,
  onViewPatient,
) {
  return [
    canUseWardRound && {
      label: 'Start Ward Round',
      variant: 'default',
      onClick: () => onOpenWardRound(admission.patient_id),
    },
    canUsePatientChronicle && {
      label: 'View Details',
      variant: 'outline',
      onClick: () => onViewPatient(admission.patient_id),
    },
  ].filter(Boolean);
}

function MyPatientsSection({
  isLoading,
  patients,
  moduleGate,
  nowMs,
  canUseWardRound,
  canUsePatientChronicle,
  onOpenWardRound,
  onViewAll,
  onViewPatient,
}) {
  return (
    <DashboardSection
      title="My Patients"
      subtitle={`${patients.length} active patients under your care`}
      actions={canUsePatientChronicle ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onViewAll}
        >
          View All
        </Button>
      ) : null}
    >
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : patients.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-border bg-card/50">
          <Users className="size-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No active patients</p>
        </div>
      ) : (
        <DashboardGrid columns="2">
          {patients.map((patient) => (
            <ActionCard
              key={patient.id}
              title={patient.patient_name}
              subtitle={`MRN: ${patient.mrn}`}
              description={patient.diagnosis || 'No diagnosis recorded'}
              status={isEstimatedDischargeDue(patient.estimated_discharge, nowMs) ? 'warning' : 'stable'}
              badges={buildPatientDischargeBadges(patient, moduleGate)}
              metadata={buildPatientMetadata(patient, moduleGate)}
              actions={buildPatientActions(
                patient,
                canUseWardRound,
                canUsePatientChronicle,
                onOpenWardRound,
                onViewPatient,
              )}
              onClick={canUsePatientChronicle ? () => onViewPatient(patient.patient_id) : undefined}
            />
          ))}
        </DashboardGrid>
      )}
    </DashboardSection>
  );
}

function isEstimatedDischargeDue(estimatedDischarge, nowMs) {
  return Boolean(nowMs && estimatedDischarge && Date.parse(estimatedDischarge) <= nowMs);
}

function buildPatientDischargeBadges(patient, moduleGate) {
  return [
    moduleGate.dischargeWorkflowsEnabled && patient.estimated_discharge && {
      text: `Discharge: ${format(new Date(patient.estimated_discharge), 'MMM d')}`,
      color: 'sky',
    },
  ].filter(Boolean);
}

function buildPatientMetadata(patient, moduleGate) {
  return [
    moduleGate.wardsEnabled && {
      label: 'Ward/Bed',
      value: `${patient.ward_name} - Bed ${patient.bed_number}`,
      icon: Bed,
    },
    {
      label: 'LOS',
      value: `${patient.length_of_stay} ${patient.length_of_stay === 1 ? 'day' : 'days'}`,
      icon: Calendar,
    },
    moduleGate.wardsEnabled && patient.last_round_date && {
      label: 'Last Round',
      value: formatDistanceToNow(new Date(patient.last_round_date), {
        addSuffix: true,
      }),
      icon: Activity,
    },
  ].filter(Boolean);
}

function buildPatientActions(
  patient,
  canUseWardRound,
  canUsePatientChronicle,
  onOpenWardRound,
  onViewPatient,
) {
  return [
    canUseWardRound && {
      label: 'Ward Round',
      variant: 'default',
      onClick: () => onOpenWardRound(patient.patient_id),
    },
    canUsePatientChronicle && {
      label: 'View Chart',
      variant: 'outline',
      onClick: () => onViewPatient(patient.patient_id),
    },
  ].filter(Boolean);
}

function PlannedDischargesSection({
  isLoading,
  discharges,
  moduleGate,
  canUseDischarge,
  canUsePatientChronicle,
  onStartDischarge,
  onViewPatient,
}) {
  return (
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
      ) : discharges.length === 0 ? (
        <div className="text-center py-8 rounded-xl border border-border bg-card/50">
          <UserCheck className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No discharges planned for today</p>
        </div>
      ) : (
        <div className="space-y-3">
          {discharges.map((discharge) => (
            <ActionCard
              key={discharge.id}
              title={discharge.patient_name}
              subtitle={`MRN: ${discharge.mrn}`}
              description={`Admitted for ${discharge.length_of_stay} ${
                discharge.length_of_stay === 1 ? 'day' : 'days'
              }`}
              status="info"
              badges={[{ text: 'DISCHARGE TODAY', color: 'sky' }]}
              metadata={buildDischargeMetadata(discharge, moduleGate)}
              actions={[
                canUseDischarge && {
                  label: 'Start Discharge',
                  variant: 'default',
                  onClick: () => onStartDischarge(discharge),
                },
                canUsePatientChronicle && {
                  label: 'View Details',
                  variant: 'outline',
                  onClick: () => onViewPatient(discharge.patient_id),
                },
              ].filter(Boolean)}
            />
          ))}
        </div>
      )}
    </DashboardSection>
  );
}

function buildDischargeMetadata(discharge, moduleGate) {
  return [
    moduleGate.wardsEnabled && {
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
  ].filter(Boolean);
}
