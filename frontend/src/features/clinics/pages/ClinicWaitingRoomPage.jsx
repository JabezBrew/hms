import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import React, { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/layout/layout';
import { PageBreadcrumb } from '@/components/layout/PageBreadcrumb';
import {
  ChroniclePageHeader,
  StatCard,
  DashboardSection,
  DashboardGrid,
} from '@/components/dashboard';
import { WaitingRoomQueue } from '@/components/visits/WaitingRoomQueue';
import { useWaitingRoom } from '@/hooks/useVisitQueries';
import { clinicsApi } from '@/lib/api/organization';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';

export default function ClinicWaitingRoomPage() {
  const { clinicId } = useParams();
  const navigate = useNavigate();
  const { facilityCode } = useAuth();

  // Fetch clinic details
  const {
    data: clinic,
    isLoading: clinicLoading,
    error: clinicError,
  } = useQuery({
    queryKey: ['clinics', clinicId],
    queryFn: () => clinicsApi.get(clinicId),
    enabled: Boolean(facilityCode) && Boolean(clinicId),
  });

  // Fetch waiting room queue
  const {
    data: queue,
    isLoading: queueLoading,
    refetch,
    isFetching,
  } = useWaitingRoom(clinicId);

  // Calculate stats
  const stats = useMemo(() => {
    if (!queue) return { waiting: 0, called: 0, total: 0 };

    const waiting = queue.filter((v) => v.visit_status === 'waiting').length;
    const called = queue.filter((v) => v.visit_status === 'called').length;

    return {
      waiting,
      called,
      total: queue.length,
    };
  }, [queue]);

  const breadcrumbItems = [
    { label: 'Clinics', href: '/admin/organization' },
    { label: clinic?.name || 'Clinic', href: `/clinics/${clinicId}` },
    { label: 'Waiting Room' },
  ];

  if (!facilityCode) {
    return (
      <Layout>
        <PageBreadcrumb items={breadcrumbItems} />
        <FacilityRequiredPanel />
      </Layout>
    );
  }

  if (clinicError) {
    return (
      <Layout>
        <PageBreadcrumb items={breadcrumbItems} />
        <div className="p-6">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6">
            <AlertTriangle className="h-6 w-6 text-rose-400 mb-2" />
            <h3 className="font-heading text-lg font-semibold text-rose-400 mb-1">
              Failed to load clinic
            </h3>
            <p className="text-sm text-muted-foreground">{clinicError.message}</p>
          </div>
        </div>
      </Layout>
    );
  }

  const handlePatientClick = (visit) => {
    navigate(`/patients/${visit.encounter_id}`);
  };

  return (
    <Layout>
      <PageBreadcrumb items={breadcrumbItems} />

      <ChroniclePageHeader
        title={clinicLoading ? 'Loading...' : `${clinic?.name} Waiting Room`}
        role="clinic"
        subtitle={clinic?.department?.name || 'Outpatient Clinic'}
        actions={
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-6 sm:space-y-8">
        {/* Statistics */}
        {queueLoading ? (
          <DashboardGrid columns="3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </DashboardGrid>
        ) : (
          <DashboardGrid columns="3">
            <StatCard
              title="Total in Queue"
              value={stats.total}
              subtitle="Patients waiting today"
              icon={Users}
              color="sky"
            />
            <StatCard
              title="Waiting"
              value={stats.waiting}
              subtitle="Ready to be called"
              icon={Clock}
              color="amber"
            />
            <StatCard
              title="Called"
              value={stats.called}
              subtitle="Awaiting consultation"
              icon={Phone}
              color="emerald"
            />
          </DashboardGrid>
        )}

        {/* Waiting Room Queue */}
        <DashboardSection
          title="Patient Queue"
          subtitle="Patients in order of check-in"
        >
          <WaitingRoomQueue
            clinicId={clinicId}
            showActions={true}
            onPatientClick={handlePatientClick}
          />
        </DashboardSection>
      </div>
    </Layout>
  );
}
